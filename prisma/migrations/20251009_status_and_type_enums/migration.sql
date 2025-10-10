-- 1) Create the new enum types (keep these if Prisma generated them already)
DO $$ BEGIN
  CREATE TYPE "ListingStatus_new" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ListingType_new" AS ENUM ('SALE', 'RENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) STATUS: drop default -> change type with explicit cast -> restore default
ALTER TABLE "Property" ALTER COLUMN "status" DROP DEFAULT;

-- If your schema added NOT NULL, keep it; otherwise remove SET NOT NULL
ALTER TABLE "Property"
  ALTER COLUMN "status" TYPE "ListingStatus_new"
  USING (
    CASE "status"::text
      WHEN 'ACTIVE'   THEN 'ACTIVE'::"ListingStatus_new"
      WHEN 'DRAFT'    THEN 'DRAFT'::"ListingStatus_new"
      WHEN 'ARCHIVED' THEN 'ARCHIVED'::"ListingStatus_new"
      ELSE 'ACTIVE'   -- fallback if any stray old values exist
    END
  );

ALTER TABLE "Property" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 3) LISTING TYPE: drop default -> change type with explicit cast -> restore default
ALTER TABLE "Property" ALTER COLUMN "listingType" DROP DEFAULT;

ALTER TABLE "Property"
  ALTER COLUMN "listingType" TYPE "ListingType_new"
  USING (
    CASE "listingType"::text
      WHEN 'SALE' THEN 'SALE'::"ListingType_new"
      WHEN 'RENT' THEN 'RENT'::"ListingType_new"
      ELSE 'SALE'  -- fallback
    END
  );

ALTER TABLE "Property" ALTER COLUMN "listingType" SET DEFAULT 'SALE';

-- 4) Swap enum names (drop old, rename new to old)
DO $$ BEGIN
  DROP TYPE IF EXISTS "ListingStatus";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TYPE "ListingStatus_new" RENAME TO "ListingStatus";

DO $$ BEGIN
  DROP TYPE IF EXISTS "ListingType";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TYPE "ListingType_new" RENAME TO "ListingType";
