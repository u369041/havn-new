// src/migrate.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists(name: string) {
  const r = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname = ${name}
    ) AS exists;
  `;
  return Boolean(r?.[0]?.exists);
}

async function getColType(table: string, column: string) {
  const r = await prisma.$queryRaw<
    { data_type: string; udt_name: string }[]
  >`
    SELECT data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${table} AND column_name=${column}
    LIMIT 1;
  `;
  if (!r?.[0]) return null;
  const { data_type, udt_name } = r[0];
  return data_type === "USER-DEFINED" ? udt_name : data_type; // "text" | "integer" | "PropertyStatus"
}

/** Drop FK on Image.propertyId if present (so we can change column types safely). */
async function dropImageFkIfExists() {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema='public' AND table_name='Image'
          AND constraint_type='FOREIGN KEY' AND constraint_name='Image_propertyId_fkey'
      ) THEN
        ALTER TABLE "Image" DROP CONSTRAINT "Image_propertyId_fkey";
      END IF;
    END $$;
  `);
}

/** Some DBs still have an old FK on PropertyImage(propertyid) -> Property(id) with the wrong type. Drop ALL FKs on PropertyImage. */
async function dropAllPropertyImageFks() {
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE c record;
    BEGIN
      FOR c IN
        SELECT conname
        FROM   pg_constraint
        WHERE  conrelid = 'public."PropertyImage"'::regclass
        AND    contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE "PropertyImage" DROP CONSTRAINT %I;', c.conname);
      END LOOP;
    END $$;
  `);
}

/** After normalization, re-add Image.propertyId -> Property.id FK if types are compatible. */
async function safeAddImageFk() {
  const propIdType = await getColType("Property", "id");
  const imgPidType = await getColType("Image", "propertyId");
  if (!propIdType || !imgPidType) return;

  if (propIdType !== imgPidType) {
    if (propIdType === "integer" || propIdType === "bigint") {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Image"
        ALTER COLUMN "propertyId" DROP DEFAULT,
        ALTER COLUMN "propertyId" TYPE ${propIdType}
        USING (CASE WHEN "propertyId" ~ '^[0-9]+$' THEN "propertyId"::${propIdType} ELSE NULL END)
      `);
    } else if (propIdType === "text") {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Image"
        ALTER COLUMN "propertyId" DROP DEFAULT,
        ALTER COLUMN "propertyId" TYPE text
        USING ("propertyId"::text)
      `);
    } else {
      console.log(\`[migrate] Skipping FK: unsupported type combo Property.id=\${propIdType} Image.propertyId=\${imgPidType}\`);
      return;
    }
  }

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      BEGIN
        ALTER TABLE "Image"
        ADD CONSTRAINT "Image_propertyId_fkey"
        FOREIGN KEY ("propertyId") REFERENCES "Property"(id) ON DELETE CASCADE;
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'Skipping FK add for Image.propertyId -> Property.id';
      END;
    END $$;
  `);
}

/** Ensure Property.id and Image.propertyId are TEXT (fixes numeric id rows). */
async function ensurePropertyIdIsText() {
  const propIdType = await getColType("Property", "id");
  if (propIdType && propIdType !== "text") {
    await dropImageFkIfExists();

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Image"
      ALTER COLUMN "propertyId" DROP DEFAULT,
      ALTER COLUMN "propertyId" TYPE text
      USING ("propertyId"::text)
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Property"
      ALTER COLUMN id TYPE text
      USING (id::text)
    `);
  } else {
    const imgPidType = await getColType("Image", "propertyId");
    if (imgPidType && imgPidType !== "text") {
      await dropImageFkIfExists();
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Image"
        ALTER COLUMN "propertyId" DROP DEFAULT,
        ALTER COLUMN "propertyId" TYPE text
        USING ("propertyId"::text)
      `);
    }
  }
}

async function run() {
  // 0) Drop any legacy FK on PropertyImage that can conflict with our new types.
  await dropAllPropertyImageFks();

  // 1) Ensure enum exists with uppercase labels
  await prisma.$executeRawUnsafe(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PropertyStatus') THEN
      CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PropertyStatus' AND e.enumlabel='DRAFT') THEN
      ALTER TYPE "PropertyStatus" ADD VALUE 'DRAFT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PropertyStatus' AND e.enumlabel='PUBLISHED') THEN
      ALTER TYPE "PropertyStatus" ADD VALUE 'PUBLISHED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='PropertyStatus' AND e.enumlabel='ARCHIVED') THEN
      ALTER TYPE "PropertyStatus" ADD VALUE 'ARCHIVED';
    END IF;
  END $$;`);

  // 2) Ensure base tables exist (minimal, we’ll add missing cols next)
  await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "User" (
    id          text PRIMARY KEY,
    email       text UNIQUE NOT NULL,
    name        text,
    role        text NOT NULL DEFAULT 'USER',
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  );`);

  await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "Property" (
    id          text PRIMARY KEY,
    slug        text UNIQUE NOT NULL,
    title       text NOT NULL,
    status      "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    price       integer NOT NULL,
    type        text NOT NULL
  );`);

  await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "Image" (
    id          text PRIMARY KEY,
    "propertyId" text,
    "publicId"  text,
    url         text,
    "sortOrder" integer NOT NULL DEFAULT 0,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  );`);

  // 3) Ensure Property.id and Image.propertyId are TEXT
  await ensurePropertyIdIsText();

  // 4) Add any missing columns on Property/Image
  await prisma.$executeRawUnsafe(`
  ALTER TABLE "Property"
    ADD COLUMN IF NOT EXISTS bedrooms    integer,
    ADD COLUMN IF NOT EXISTS bathrooms   integer,
    ADD COLUMN IF NOT EXISTS address     text,
    ADD COLUMN IF NOT EXISTS latitude    double precision,
    ADD COLUMN IF NOT EXISTS longitude   double precision,
    ADD COLUMN IF NOT EXISTS description text,
    ADD COLUMN IF NOT EXISTS "ownerId"   text,
    ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now();
  `);

  // Ensure status column is enum type
  await prisma.$executeRawUnsafe(`
  DO $$
  DECLARE currtyp text;
  BEGIN
    SELECT t.typname INTO currtyp
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE n.nspname='public' AND c.relname='Property' AND a.attname='status';

    IF currtyp IS NOT NULL AND currtyp <> 'PropertyStatus' THEN
      ALTER TABLE "Property"
      ALTER COLUMN status TYPE "PropertyStatus"
      USING status::text::"PropertyStatus";
    END IF;
  END $$;`);

  // Normalize lowercase values
  await prisma.$executeRawUnsafe(`
    UPDATE "Property" SET status = 'DRAFT'::"PropertyStatus"     WHERE status::text IN ('draft','Draft');
    UPDATE "Property" SET status = 'PUBLISHED'::"PropertyStatus" WHERE status::text IN ('published','Published');
    UPDATE "Property" SET status = 'ARCHIVED'::"PropertyStatus"  WHERE status::text IN ('archived','Archived');
  `);

  // 5) Indexes (idempotent)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_status" ON "Property"(status);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_type"   ON "Property"(type);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_price"  ON "Property"(price);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_image_property"  ON "Image"("propertyId");`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_image_property_sort" ON "Image"("propertyId","sortOrder");`);

  // 6) Backfill (read from legacy, write to normalized)
  const hasListing = await tableExists("Listing");
  const hasPropImg = await tableExists("PropertyImage");

  if (hasListing) {
    await prisma.$executeRawUnsafe(`
    INSERT INTO "Property"(id, slug, title, status, price, type, bedrooms, bathrooms, address, description, "createdAt", "updatedAt")
    SELECT
      l.id::text,
      l.slug,
      COALESCE(l.title, 'Untitled'),
      CASE
        WHEN l.status IN ('DRAFT','PUBLISHED','ARCHIVED') THEN l.status::"PropertyStatus"
        WHEN l.status IN ('draft','published','archived') THEN upper(l.status)::"PropertyStatus"
        ELSE 'DRAFT'::"PropertyStatus"
      END,
      COALESCE(l.price, 0),
      COALESCE(NULLIF(l.type, ''), 'SALE/HOUSE'),
      l.beds,
      l.baths,
      l.address,
      l.description,
      COALESCE(l."createdAt", now()),
      COALESCE(l."updatedAt", now())
    FROM "Listing" l
    WHERE NOT EXISTS (SELECT 1 FROM "Property" p WHERE p.id = l.id::text OR p.slug = l.slug);
    `);
  }

  if (hasPropImg) {
    await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE prop_col text;
    DECLARE sort_col text;
    DECLARE pub_col  text;
    DECLARE created_col text;
    DECLARE pub_expr text;
    DECLARE sort_expr text;
    DECLARE created_expr text;
    BEGIN
      SELECT column_name INTO prop_col
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='PropertyImage'
        AND column_name IN ('propertyId','property_id','propertyid')
      ORDER BY column_name LIMIT 1;

      SELECT column_name INTO sort_col
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='PropertyImage'
        AND column_name IN ('sort','sortOrder','order','position')
      ORDER BY column_name LIMIT 1;

      SELECT column_name INTO pub_col
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='PropertyImage'
        AND column_name IN ('publicId','public_id')
      ORDER BY column_name LIMIT 1;

      SELECT column_name INTO created_col
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='PropertyImage'
        AND column_name IN ('createdAt','created_at')
      ORDER BY column_name LIMIT 1;

      IF prop_col IS NOT NULL THEN
        IF sort_col IS NOT NULL THEN
          EXECUTE format(
            'DELETE FROM "PropertyImage" a
               USING "PropertyImage" b
             WHERE a.id < b.id
               AND a.%1$I = b.%1$I
               AND COALESCE(a.%2$I,0) = COALESCE(b.%2$I,0);',
            prop_col, sort_col
          );
        END IF;

        pub_expr := CASE WHEN pub_col IS NULL THEN 'NULL' ELSE format('i.%I', pub_col) END;
        sort_expr := CASE WHEN sort_col IS NULL THEN '0' ELSE format('COALESCE(i.%I,0)', sort_col) END;
        created_expr := CASE WHEN created_col IS NULL THEN 'now()' ELSE format('COALESCE(i.%I, now())', created_col) END;

        EXECUTE format(
          'INSERT INTO "Image"(id, "propertyId", "publicId", url, "sortOrder", "createdAt")
             SELECT i.id::text, (i.%1$I)::text, %2$s, i.url, %3$s, %4$s
               FROM "PropertyImage" i
              WHERE EXISTS (SELECT 1 FROM "Property" p WHERE p.id = (i.%1$I)::text)
                AND NOT EXISTS (SELECT 1 FROM "Image" x WHERE x.id = i.id::text);',
          prop_col, pub_expr, sort_expr, created_expr
        );
      END IF;
    END $$;`);
  }

  // 7) Re-attach FK on Image if possible
  await safeAddImageFk();

  // 8) Defensive default for type
  await prisma.$executeRawUnsafe(`UPDATE "Property" SET type = 'SALE/HOUSE' WHERE type IS NULL OR type = '';`);

  console.log("[migrate] Schema ensured, legacy backfill complete (legacy PropertyImage FKs dropped).");
}

run()
  .catch((e) => {
    console.error("[migrate] ERROR", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
