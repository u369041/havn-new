-- CreateEnum
CREATE TYPE "CrmViewingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CrmViewingOutcome" AS ENUM ('INTERESTED', 'CONSIDERING', 'NOT_INTERESTED', 'SECOND_VIEWING', 'OFFER_INTENT', 'OTHER');

-- CreateTable
CREATE TABLE "CrmViewing" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "opportunityId" INTEGER,
    "inventoryPropertyId" INTEGER,
    "assignedMemberId" INTEGER,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" "CrmViewingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" "CrmViewingOutcome",
    "notes" TEXT,
    "feedbackNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmViewing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmViewing_agencyId_idx" ON "CrmViewing"("agencyId");

-- CreateIndex
CREATE INDEX "CrmViewing_contactId_idx" ON "CrmViewing"("contactId");

-- CreateIndex
CREATE INDEX "CrmViewing_opportunityId_idx" ON "CrmViewing"("opportunityId");

-- CreateIndex
CREATE INDEX "CrmViewing_inventoryPropertyId_idx" ON "CrmViewing"("inventoryPropertyId");

-- CreateIndex
CREATE INDEX "CrmViewing_assignedMemberId_idx" ON "CrmViewing"("assignedMemberId");

-- CreateIndex
CREATE INDEX "CrmViewing_scheduledAt_idx" ON "CrmViewing"("scheduledAt");

-- CreateIndex
CREATE INDEX "CrmViewing_status_idx" ON "CrmViewing"("status");

-- CreateIndex
CREATE INDEX "CrmViewing_agencyId_scheduledAt_idx" ON "CrmViewing"("agencyId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CrmViewing_agencyId_assignedMemberId_scheduledAt_idx" ON "CrmViewing"("agencyId", "assignedMemberId", "scheduledAt");

-- CreateIndex
CREATE INDEX "CrmViewing_opportunityId_scheduledAt_idx" ON "CrmViewing"("opportunityId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmViewing" ADD CONSTRAINT "CrmViewing_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
