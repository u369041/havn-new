-- CreateEnum
CREATE TYPE "CrmInteractionType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SMS', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmInteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CrmInteractionProvider" AS ENUM ('MANUAL', 'GOOGLE', 'MICROSOFT');

-- CreateTable
CREATE TABLE "CrmInteraction" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "companyId" INTEGER,
    "opportunityId" INTEGER,
    "inventoryPropertyId" INTEGER,
    "ownerMemberId" INTEGER,
    "type" "CrmInteractionType" NOT NULL,
    "direction" "CrmInteractionDirection" NOT NULL DEFAULT 'INTERNAL',
    "subject" TEXT,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMinutes" INTEGER,
    "sourceProvider" "CrmInteractionProvider" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "externalThreadId" TEXT,
    "externalUrl" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmInteraction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmInteraction_agencyId_idx" ON "CrmInteraction"("agencyId");
CREATE INDEX "CrmInteraction_contactId_idx" ON "CrmInteraction"("contactId");
CREATE INDEX "CrmInteraction_companyId_idx" ON "CrmInteraction"("companyId");
CREATE INDEX "CrmInteraction_opportunityId_idx" ON "CrmInteraction"("opportunityId");
CREATE INDEX "CrmInteraction_inventoryPropertyId_idx" ON "CrmInteraction"("inventoryPropertyId");
CREATE INDEX "CrmInteraction_ownerMemberId_idx" ON "CrmInteraction"("ownerMemberId");
CREATE INDEX "CrmInteraction_type_idx" ON "CrmInteraction"("type");
CREATE INDEX "CrmInteraction_occurredAt_idx" ON "CrmInteraction"("occurredAt");
CREATE INDEX "CrmInteraction_agencyId_occurredAt_idx" ON "CrmInteraction"("agencyId", "occurredAt");
CREATE INDEX "CrmInteraction_agencyId_contactId_occurredAt_idx" ON "CrmInteraction"("agencyId", "contactId", "occurredAt");
CREATE INDEX "CrmInteraction_agencyId_opportunityId_occurredAt_idx" ON "CrmInteraction"("agencyId", "opportunityId", "occurredAt");
CREATE UNIQUE INDEX "CrmInteraction_agencyId_sourceProvider_externalId_key" ON "CrmInteraction"("agencyId", "sourceProvider", "externalId");

ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmInteraction" ADD CONSTRAINT "CrmInteraction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
