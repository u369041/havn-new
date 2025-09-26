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
  // 1) Ensure enum exists
  await prisma.$executeRawUnsafe(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Status') THEN
      CREATE TYPE "Status" AS ENUM ('DRAFT','PUBLISHED','ARCHIVED');
    END IF;
  END $$;`);

  // 2) Ensure tables exist (no drops)
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
    status      "Status" NOT NULL DEFAULT 'DRAFT',
    price       integer NOT NULL,
    type        text NOT NULL,
    bedrooms    integer,
    bathrooms   integer,
    address     text,
    latitude    double precision,
    longitude   double precision,
    description text,
    "ownerId"   text REFERENCES "User"(id) ON DELETE SET NULL,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now()
  );`);

  await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS "Image" (
    id          text PRIMARY KEY,
    "propertyId" text NOT NULL REFERENCES "Property"(id) ON DELETE CASCADE,
    "publicId"  text,
    url         text,
    "sortOrder" integer NOT NULL DEFAULT 0,
    "createdAt" timestamptz NOT NULL DEFAULT now()
  );`);

  // 3) Indexes
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_status" ON "Property"(status);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_type"   ON "Property"(type);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_property_price"  ON "Property"(price);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_image_property"  ON "Image"("propertyId");`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_image_property_sort" ON "Image"("propertyId","sortOrder");`);

  // 4) Backfill from legacy tables if they exist
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
        WHEN l.status IN ('DRAFT','PUBLISHED','ARCHIVED') THEN l.status::"Status"
        ELSE 'DRAFT'::"Status"
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
    await prisma.$executeRawUnsafe(`
    DELETE FROM "PropertyImage" a
    USING "PropertyImage" b
    WHERE a.id < b.id
      AND a."propertyId" = b."propertyId"
      AND COALESCE(a.sort,0) = COALESCE(b.sort,0);
    `);

    await prisma.$executeRawUnsafe(`
    INSERT INTO "Image"(id, "propertyId", "publicId", url, "sortOrder", "createdAt")
    SELECT
      i.id,
      i."propertyId",
      i."publicId",
      i.url,
      COALESCE(i.sort, 0),
      COALESCE(i."createdAt", now())
    FROM "PropertyImage" i
    WHERE EXISTS (SELECT 1 FROM "Property" p WHERE p.id = i."propertyId")
      AND NOT EXISTS (SELECT 1 FROM "Image" x WHERE x.id = i.id);
    `);
  }

  await prisma.$executeRawUnsafe(`UPDATE "Property" SET type = 'SALE/HOUSE' WHERE type IS NULL OR type = '';`);

  console.log("[migrate] Schema ensured, legacy backfill complete.");
}

run()
  .catch((e) => {
    console.error("[migrate] ERROR", e);
    // don't exit hard; allow app to start so you can inspect logs
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
