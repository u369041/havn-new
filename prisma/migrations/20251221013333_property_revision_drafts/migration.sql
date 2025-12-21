-- DropIndex
DROP INDEX "Property_listingStatus_idx";

-- DropIndex
DROP INDEX "Property_publishedAt_idx";

-- DropIndex
DROP INDEX "Property_userId_idx";

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "revisionOfId" INTEGER;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
