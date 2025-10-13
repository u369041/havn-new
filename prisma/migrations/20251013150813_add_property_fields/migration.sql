/*
  Warnings:

  - You are about to drop the column `addressLine1` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `addressLine2` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `areaSqFt` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `bathrooms` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `bedrooms` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `latitude` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `longitude` on the `Property` table. All the data in the column will be lost.
  - The `status` column on the `Property` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `PropertyImage` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `address` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `listingType` on the `Property` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `eircode` on table `Property` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "PropertyImage" DROP CONSTRAINT "PropertyImage_propertyId_fkey";

-- DropIndex
DROP INDEX "Property_city_idx";

-- DropIndex
DROP INDEX "Property_county_idx";

-- DropIndex
DROP INDEX "Property_listingType_idx";

-- DropIndex
DROP INDEX "Property_status_idx";

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "addressLine1",
DROP COLUMN "addressLine2",
DROP COLUMN "areaSqFt",
DROP COLUMN "bathrooms",
DROP COLUMN "bedrooms",
DROP COLUMN "latitude",
DROP COLUMN "longitude",
ADD COLUMN     "address" TEXT NOT NULL,
ADD COLUMN     "area" INTEGER,
ADD COLUMN     "baths" INTEGER,
ADD COLUMN     "beds" INTEGER,
ADD COLUMN     "ber" TEXT,
ADD COLUMN     "floorplans" TEXT[],
ADD COLUMN     "images" TEXT[],
ADD COLUMN     "pricePeriod" TEXT,
ADD COLUMN     "type" TEXT,
ADD COLUMN     "videoUrl" TEXT,
ALTER COLUMN "description" DROP NOT NULL,
DROP COLUMN "listingType",
ADD COLUMN     "listingType" TEXT NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'For Sale',
ALTER COLUMN "eircode" SET NOT NULL;

-- DropTable
DROP TABLE "PropertyImage";

-- DropEnum
DROP TYPE "ListingStatus";

-- DropEnum
DROP TYPE "ListingType";

-- CreateIndex
CREATE INDEX "Property_createdAt_idx" ON "Property"("createdAt");

-- CreateIndex
CREATE INDEX "Property_listingType_status_idx" ON "Property"("listingType", "status");

-- CreateIndex
CREATE INDEX "Property_eircode_idx" ON "Property"("eircode");
