-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "archivedAt" TIMESTAMP(3);
