-- CreateEnum
CREATE TYPE "InventoryMediaKind" AS ENUM ('IMAGE', 'VIDEO', 'FLOOR_PLAN', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "InventoryMediaSource" AS ENUM ('CLOUDINARY', 'EXTERNAL_URL');

-- CreateEnum
CREATE TYPE "InventoryMediaVisibility" AS ENUM ('LISTING_ELIGIBLE', 'INTERNAL_ONLY');

-- CreateTable
CREATE TABLE "InventoryMedia" (
    "id" SERIAL NOT NULL,
    "inventoryPropertyId" INTEGER NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "kind" "InventoryMediaKind" NOT NULL,
    "source" "InventoryMediaSource" NOT NULL DEFAULT 'CLOUDINARY',
    "visibility" "InventoryMediaVisibility" NOT NULL DEFAULT 'LISTING_ELIGIBLE',
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "publicId" TEXT,
    "resourceType" TEXT,
    "format" TEXT,
    "mimeType" TEXT,
    "originalFilename" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "duration" DOUBLE PRECISION,
    "title" TEXT,
    "caption" TEXT,
    "category" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "externalProvider" TEXT,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryMedia_inventoryPropertyId_idx" ON "InventoryMedia"("inventoryPropertyId");

-- CreateIndex
CREATE INDEX "InventoryMedia_agencyId_idx" ON "InventoryMedia"("agencyId");

-- CreateIndex
CREATE INDEX "InventoryMedia_kind_idx" ON "InventoryMedia"("kind");

-- CreateIndex
CREATE INDEX "InventoryMedia_visibility_idx" ON "InventoryMedia"("visibility");

-- CreateIndex
CREATE INDEX "InventoryMedia_inventoryPropertyId_kind_idx" ON "InventoryMedia"("inventoryPropertyId", "kind");

-- CreateIndex
CREATE INDEX "InventoryMedia_inventoryPropertyId_position_idx" ON "InventoryMedia"("inventoryPropertyId", "position");

-- CreateIndex
CREATE INDEX "InventoryMedia_agencyId_createdAt_idx" ON "InventoryMedia"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMedia_createdByUserId_idx" ON "InventoryMedia"("createdByUserId");

-- CreateIndex
CREATE INDEX "InventoryMedia_updatedByUserId_idx" ON "InventoryMedia"("updatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMedia_inventoryPropertyId_publicId_key" ON "InventoryMedia"("inventoryPropertyId", "publicId");

-- AddForeignKey
ALTER TABLE "InventoryMedia" ADD CONSTRAINT "InventoryMedia_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMedia" ADD CONSTRAINT "InventoryMedia_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMedia" ADD CONSTRAINT "InventoryMedia_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMedia" ADD CONSTRAINT "InventoryMedia_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
