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

async function run() {
  // 1) Ensure the DB enum **PropertyStatus** exists and has uppercase labels.
  await prisma.$executeRawUnsafe(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PropertyStatus') THEN
      CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PropertyStatus' AND e.enumlabel = 'DRAFT'
    ) THEN ALTER TYPE "PropertyStatus" ADD VALUE 'DRAFT'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PropertyStatus' AND e.enumlabel = 'PUBLISHED'
    ) THEN ALTER TYPE "PropertyStatus" ADD VALUE 'PUBLISHED'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PropertyStatus' AND e.enumlabel = 'ARCHIVED'
    ) THEN ALTER TYPE "PropertyStatus" ADD VALUE 'ARCHIVED'; END IF;
  END $$;`);

  // 2) Create base tables if missing (Property.status uses PropertyStatus)
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

  // 3) ADD ANY MISSING COLUMNS (idempotent)
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

  await prisma.$executeRawUnsafe(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_type='FOREIGN KEY'
        AND table_name='Property'
        AND constraint_name='Property_ownerId_fkey'
    ) THEN
      ALTER TABLE "Property"
      ADD CONSTRAINT "Property_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE SET NULL;
    END IF;
  END $$;`);

  await prisma.$executeRawUnsafe(`
  ALTER TABLE "Image"
    ADD COLUMN IF NOT EXISTS "propertyId" text,
    ADD COLUMN IF NOT EXISTS "publicId"   text,
    ADD COLUMN IF NOT EXISTS url          text,
    ADD COLUMN IF NOT EXISTS "sortOrder"  integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "createdAt"  timestamptz NOT NULL DEFAULT now();
  `);

  await prisma.$executeRawUnsafe(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_type='FOREIGN KEY'
        AND table_name='Image'
        AND constraint_name='Image_propertyId_fkey'
    ) THEN
      ALTER TABLE "Image"
      ADD CONSTRAINT "Image_propertyId_fkey"
      FOREIGN KEY ("propertyId") REFERENCES "Property"(id) ON DELETE CASCADE;
    END IF;
  END $$;`);

  // 4) Ensure Property.status column type is the enum
  await prisma.$executeRawUnsafe(`
  DO $$
  DECLARE currtyp text;
  BEGIN
    SELECT t.typname INTO currtyp
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = 'public' AND c.relname = 'Property' AND a.attname = 'status';

    IF currtyp IS NOT NULL AND currtyp <> 'PropertyStatus' THEN
      ALTER TABLE "Property"
      ALTER COLUMN status TYPE "PropertyStatus"
      USING status::text::"PropertyStatus";
    END IF;
  END $$;`);

  // 5) Normalize any lowercase values (defensive)
  await prisma.$executeRawUnsafe(`
    UPDATE "Property" SET status = 'DRAFT'::"PropertyStatus"     WHERE status::text IN ('draft','Draft');
    UPDATE "Property" SET status = 'PUBLISHED'::"PropertyStatus" WHERE status::text IN ('published','Published');
    UPDATE "Property" SET status = 'ARCHIVED'::"PropertyStatus"  WHERE status::text IN ('archived','Archived');
  `);

  // 6) Indexes (safe no-ops if already exist)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_status" ON "Property"(status);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_type"   ON "Property"(type);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_price"  ON "Property"(price);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_image_property"  ON "Image"("propertyId");`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_image_property_sort" ON "Image"("propertyId","sortOrder");`);

  // 7) Backfill from legacy tables if present (unchanged)
  const hasListing = await tableExists("Listing");
  const hasPropImg = await tableExists("PropertyImage");

  if (hasListing) {
    await prisma.$executeRawUnsafe(`
    INSERT INTO "Property"(id, slug, title, status, price, type, bedrooms, bathrooms, address, description, "createdAt", "updatedAt")
    SELECT
      l.id,
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
    WHERE NOT EXISTS (SELECT 1 FROM "Property" p WHERE p.id = l.id OR p.slug = l.slug);
    `);
  }

  if (hasPropImg) {
    // robust image backfill — detect column names dynamically
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
             SELECT i.id, i.%1$I, %2$s, i.url, %3$s, %4$s
               FROM "PropertyImage" i
              WHERE EXISTS (SELECT 1 FROM "Property" p WHERE p.id = i.%1$I)
                AND NOT EXISTS (SELECT 1 FROM "Image" x WHERE x.id = i.id);',
          prop_col, pub_expr, sort_expr, created_expr
        );
      END IF;
    END $$;`);
  }

  // 8) Default unknown type values (defensive)
  await prisma.$executeRawUnsafe(`UPDATE "Property" SET type = 'SALE/HOUSE' WHERE type IS NULL OR type = '';`);

  console.log("[migrate] Schema ensured, legacy backfill complete (columns ensured).");
}

run()
  .catch((e) => {
    console.error("[migrate] ERROR", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
