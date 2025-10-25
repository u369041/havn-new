-- /havn-new/sql/bootstrap.sql
-- Manual creation of the Property table for HAVN.
-- Run this once if Prisma can't create the table automatically.

CREATE TABLE IF NOT EXISTS "Property" (
  "id" SERIAL PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "address1" TEXT,
  "address2" TEXT,
  "city" TEXT,
  "county" TEXT,
  "eircode" TEXT,
  "price" DOUBLE PRECISION,
  "status" TEXT,
  "propertyType" TEXT,
  "ber" TEXT,
  "bedrooms" INTEGER,
  "bathrooms" INTEGER,
  "size" DOUBLE PRECISION,
  "sizeUnits" TEXT,
  "features" TEXT[] NOT NULL DEFAULT '{}',
  "description" TEXT,
  "photos" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "Property" IS 'Stores property listings for havn.ie';
COMMENT ON COLUMN "Property".slug IS 'URL-safe unique identifier for each listing';
COMMENT ON COLUMN "Property".features IS 'Array of key property features';
COMMENT ON COLUMN "Property".photos IS 'Array of Cloudinary URLs';
