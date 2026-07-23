-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "locationId" INTEGER;

-- CreateIndex
CREATE INDEX "Property_locationId_idx" ON "Property"("locationId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
