-- CreateEnum
CREATE TYPE "ListingRevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ListingRevision" (
    "id" SERIAL NOT NULL,
    "propertyId" INTEGER NOT NULL,
    "agencyId" INTEGER,
    "inventoryPropertyId" INTEGER,
    "status" "ListingRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL,
    "beforeState" JSONB NOT NULL,
    "proposedState" JSONB NOT NULL,
    "changedFields" TEXT[],
    "submittedByUserId" INTEGER,
    "reviewedByUserId" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingRevision_propertyId_idx" ON "ListingRevision"("propertyId");

-- CreateIndex
CREATE INDEX "ListingRevision_propertyId_status_idx" ON "ListingRevision"("propertyId", "status");

-- CreateIndex
CREATE INDEX "ListingRevision_status_idx" ON "ListingRevision"("status");

-- CreateIndex
CREATE INDEX "ListingRevision_agencyId_status_idx" ON "ListingRevision"("agencyId", "status");

-- CreateIndex
CREATE INDEX "ListingRevision_inventoryPropertyId_status_idx" ON "ListingRevision"("inventoryPropertyId", "status");

-- CreateIndex
CREATE INDEX "ListingRevision_submittedByUserId_idx" ON "ListingRevision"("submittedByUserId");

-- CreateIndex
CREATE INDEX "ListingRevision_reviewedByUserId_idx" ON "ListingRevision"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "ListingRevision_submittedAt_idx" ON "ListingRevision"("submittedAt");

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingRevision" ADD CONSTRAINT "ListingRevision_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
