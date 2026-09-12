-- CreateEnum
CREATE TYPE "CrmSaleProgressionStatus" AS ENUM ('SALE_AGREED', 'SOLICITORS_INSTRUCTED', 'MEMORANDUM_ISSUED', 'CONTRACTS_ISSUED', 'SURVEY_COMPLETE', 'LOAN_OFFER', 'CONTRACTS_SIGNED', 'CLOSING_AGREED', 'CLOSED', 'FALLEN_THROUGH');

-- CreateEnum
CREATE TYPE "CrmBuyerFundingStatus" AS ENUM ('UNKNOWN', 'CASH', 'MORTGAGE');

-- CreateTable
CREATE TABLE "CrmSaleProgression" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "opportunityId" INTEGER NOT NULL,
    "inventoryPropertyId" INTEGER NOT NULL,
    "acceptedOfferId" INTEGER NOT NULL,
    "buyerContactId" INTEGER,
    "vendorContactId" INTEGER,
    "buyerSolicitorId" INTEGER,
    "vendorSolicitorId" INTEGER,
    "assignedMemberId" INTEGER,
    "agreedPriceCents" BIGINT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CrmSaleProgressionStatus" NOT NULL DEFAULT 'SALE_AGREED',
    "buyerFunding" "CrmBuyerFundingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "proofOfFundsReceivedAt" TIMESTAMP(3),
    "mortgageApprovalAt" TIMESTAMP(3),
    "bookingDepositCents" BIGINT,
    "bookingDepositRequestedAt" TIMESTAMP(3),
    "bookingDepositReceivedAt" TIMESTAMP(3),
    "solicitorsInstructedAt" TIMESTAMP(3),
    "memorandumIssuedAt" TIMESTAMP(3),
    "contractsIssuedAt" TIMESTAMP(3),
    "surveyCompletedAt" TIMESTAMP(3),
    "loanOfferAt" TIMESTAMP(3),
    "contractsSignedAt" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "fallenThroughAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmSaleProgression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmSaleProgression_opportunityId_key" ON "CrmSaleProgression"("opportunityId");
CREATE UNIQUE INDEX "CrmSaleProgression_inventoryPropertyId_key" ON "CrmSaleProgression"("inventoryPropertyId");
CREATE UNIQUE INDEX "CrmSaleProgression_acceptedOfferId_key" ON "CrmSaleProgression"("acceptedOfferId");
CREATE INDEX "CrmSaleProgression_agencyId_idx" ON "CrmSaleProgression"("agencyId");
CREATE INDEX "CrmSaleProgression_status_idx" ON "CrmSaleProgression"("status");
CREATE INDEX "CrmSaleProgression_assignedMemberId_idx" ON "CrmSaleProgression"("assignedMemberId");
CREATE INDEX "CrmSaleProgression_buyerContactId_idx" ON "CrmSaleProgression"("buyerContactId");
CREATE INDEX "CrmSaleProgression_vendorContactId_idx" ON "CrmSaleProgression"("vendorContactId");
CREATE INDEX "CrmSaleProgression_closingDate_idx" ON "CrmSaleProgression"("closingDate");
CREATE INDEX "CrmSaleProgression_agencyId_status_idx" ON "CrmSaleProgression"("agencyId", "status");
CREATE INDEX "CrmSaleProgression_agencyId_assignedMemberId_status_idx" ON "CrmSaleProgression"("agencyId", "assignedMemberId", "status");

-- AddForeignKey
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "CrmOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_acceptedOfferId_fkey" FOREIGN KEY ("acceptedOfferId") REFERENCES "CrmOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_buyerContactId_fkey" FOREIGN KEY ("buyerContactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_vendorContactId_fkey" FOREIGN KEY ("vendorContactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_buyerSolicitorId_fkey" FOREIGN KEY ("buyerSolicitorId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_vendorSolicitorId_fkey" FOREIGN KEY ("vendorSolicitorId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmSaleProgression" ADD CONSTRAINT "CrmSaleProgression_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill sale progression from the latest accepted offer per Inventory property
INSERT INTO "CrmSaleProgression" (
  "agencyId", "opportunityId", "inventoryPropertyId", "acceptedOfferId", "buyerContactId", "vendorContactId", "assignedMemberId",
  "agreedPriceCents", "agreedAt", "status", "buyerFunding", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (o."inventoryPropertyId")
  o."agencyId", o."opportunityId", o."inventoryPropertyId", o."id", o."contactId", p."primaryContactId", o."assignedMemberId",
  o."amountCents", COALESCE(o."respondedAt", o."updatedAt"), 'SALE_AGREED'::"CrmSaleProgressionStatus", 'UNKNOWN'::"CrmBuyerFundingStatus",
  o."updatedByUserId", o."updatedByUserId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CrmOffer" o
JOIN "InventoryProperty" p ON p."id" = o."inventoryPropertyId"
WHERE o."status" = 'ACCEPTED'
ORDER BY o."inventoryPropertyId", COALESCE(o."respondedAt", o."updatedAt") DESC, o."id" DESC
ON CONFLICT DO NOTHING;
