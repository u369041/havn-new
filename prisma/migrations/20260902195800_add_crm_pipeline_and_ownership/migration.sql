-- CreateEnum
CREATE TYPE "CrmTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CrmOpportunityType" AS ENUM ('VENDOR_INSTRUCTION', 'BUYER_SEARCH', 'LANDLORD_INSTRUCTION', 'TENANT_SEARCH', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmOpportunityStage" AS ENUM ('LEAD', 'QUALIFIED', 'APPOINTMENT', 'INSTRUCTION', 'ACTIVE', 'NEGOTIATION', 'AGREED', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "CrmFollowUp"
ADD COLUMN "assignedMemberId" INTEGER,
ADD COLUMN "priority" "CrmTaskPriority" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "CrmOpportunity" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "companyId" INTEGER,
    "inventoryPropertyId" INTEGER,
    "ownerMemberId" INTEGER,
    "title" TEXT NOT NULL,
    "type" "CrmOpportunityType" NOT NULL,
    "stage" "CrmOpportunityStage" NOT NULL DEFAULT 'LEAD',
    "valueCents" INTEGER,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "expectedCloseAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmFollowUp_assignedMemberId_idx" ON "CrmFollowUp"("assignedMemberId");
CREATE INDEX "CrmFollowUp_priority_idx" ON "CrmFollowUp"("priority");
CREATE INDEX "CrmFollowUp_agencyId_assignedMemberId_dueAt_idx" ON "CrmFollowUp"("agencyId", "assignedMemberId", "dueAt");

CREATE INDEX "CrmOpportunity_agencyId_idx" ON "CrmOpportunity"("agencyId");
CREATE INDEX "CrmOpportunity_contactId_idx" ON "CrmOpportunity"("contactId");
CREATE INDEX "CrmOpportunity_companyId_idx" ON "CrmOpportunity"("companyId");
CREATE INDEX "CrmOpportunity_inventoryPropertyId_idx" ON "CrmOpportunity"("inventoryPropertyId");
CREATE INDEX "CrmOpportunity_ownerMemberId_idx" ON "CrmOpportunity"("ownerMemberId");
CREATE INDEX "CrmOpportunity_type_idx" ON "CrmOpportunity"("type");
CREATE INDEX "CrmOpportunity_stage_idx" ON "CrmOpportunity"("stage");
CREATE INDEX "CrmOpportunity_isArchived_idx" ON "CrmOpportunity"("isArchived");
CREATE INDEX "CrmOpportunity_expectedCloseAt_idx" ON "CrmOpportunity"("expectedCloseAt");
CREATE INDEX "CrmOpportunity_agencyId_stage_isArchived_idx" ON "CrmOpportunity"("agencyId", "stage", "isArchived");
CREATE INDEX "CrmOpportunity_agencyId_ownerMemberId_stage_idx" ON "CrmOpportunity"("agencyId", "ownerMemberId", "stage");

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmOpportunity" ADD CONSTRAINT "CrmOpportunity_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
