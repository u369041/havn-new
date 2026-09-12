-- CreateEnum
CREATE TYPE "CrmOfferStatus" AS ENUM ('SUBMITTED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED');

-- CreateTable
CREATE TABLE "CrmOffer" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "opportunityId" INTEGER NOT NULL,
    "inventoryPropertyId" INTEGER NOT NULL,
    "assignedMemberId" INTEGER,
    "amountCents" BIGINT NOT NULL,
    "status" "CrmOfferStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmOffer_agencyId_idx" ON "CrmOffer"("agencyId");
CREATE INDEX "CrmOffer_contactId_idx" ON "CrmOffer"("contactId");
CREATE INDEX "CrmOffer_opportunityId_idx" ON "CrmOffer"("opportunityId");
CREATE INDEX "CrmOffer_inventoryPropertyId_idx" ON "CrmOffer"("inventoryPropertyId");
CREATE INDEX "CrmOffer_assignedMemberId_idx" ON "CrmOffer"("assignedMemberId");
CREATE INDEX "CrmOffer_status_idx" ON "CrmOffer"("status");
CREATE INDEX "CrmOffer_submittedAt_idx" ON "CrmOffer"("submittedAt");
CREATE INDEX "CrmOffer_agencyId_submittedAt_idx" ON "CrmOffer"("agencyId", "submittedAt");
CREATE INDEX "CrmOffer_agencyId_inventoryPropertyId_submittedAt_idx" ON "CrmOffer"("agencyId", "inventoryPropertyId", "submittedAt");
CREATE INDEX "CrmOffer_opportunityId_submittedAt_idx" ON "CrmOffer"("opportunityId", "submittedAt");

ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOffer" ADD CONSTRAINT "CrmOffer_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
