-- Safely replace enum variants in Postgres created by Prisma.
-- Table/column names and enum names match Prisma defaults:
--   table: "Property"
--   column: "status"        uses enum "ListingStatus"
--   column: "listingType"   uses enum "ListingType"

----------------------------------------------------------------
-- 1) ListingStatus: keep only 'ACTIVE' (map anything else to it)
----------------------------------------------------------------
DO $$
BEGIN
  -- Only run if the current enum exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ListingStatus') THEN
    -- Create the new restricted enum
    CREATE TYPE "ListingStatus_new" AS ENUM ('ACTIVE');

    -- Re-type the column, mapping old values to the new set
    ALTER TABLE "Property"
      ALTER COLUMN "status"
      TYPE "ListingStatus_new"
      USING (
        CASE
          WHEN "status" IN ('ACTIVE', 'DRAFT', 'ARCHIVED') THEN 'ACTIVE'::"ListingStatus_new"
          ELSE 'ACTIVE'::"ListingStatus_new"
        END
      );

    -- Swap types
    DROP TYPE "ListingStatus";
    ALTER TYPE "ListingStatus_new" RENAME TO "ListingStatus";
  END IF;
END $$;

----------------------------------------------------------------
-- 2) ListingType: remove 'SHARE' by mapping it to 'RENT'
----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ListingType') THEN
    -- Keep only SALE and RENT
    CREATE TYPE "ListingType_new" AS ENUM ('SALE','RENT');

    ALTER TABLE "Property"
      ALTER COLUMN "listingType"
      TYPE "ListingType_new"
      USING (
        CASE
          WHEN "listingType" = 'SALE' THEN 'SALE'::"ListingType_new"
          -- Map SHARE (and any other stray values) to RENT
          ELSE 'RENT'::"ListingType_new"
        END
      );

    DROP TYPE "ListingType";
    ALTER TYPE "ListingType_new" RENAME TO "ListingType";
  END IF;
END $$;
