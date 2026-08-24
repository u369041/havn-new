-- CreateEnum
CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgencyMemberRole" AS ENUM ('OWNER', 'ADMIN', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "AgencyMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProfessionalContactRole" AS ENUM ('VENDOR', 'BUYER', 'LANDLORD', 'TENANT', 'SOLICITOR', 'BROKER', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryTransactionType" AS ENUM ('SALE', 'RENTAL');

-- CreateEnum
CREATE TYPE "InventoryStage" AS ENUM ('PROSPECT', 'APPRAISAL', 'INSTRUCTION', 'PREPARING', 'READY_TO_LIST', 'LIVE', 'SALE_AGREED', 'LET_AGREED', 'SOLD', 'LET_COMPLETED', 'WITHDRAWN', 'LOST');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "agencyId" INTEGER,
ADD COLUMN     "createdByUserId" INTEGER,
ADD COLUMN     "inventoryPropertyId" INTEGER,
ADD COLUMN     "updatedByUserId" INTEGER;

-- CreateTable
CREATE TABLE "Agency" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "slug" TEXT NOT NULL,
    "psraLicenceNumber" TEXT,
    "primaryEmail" TEXT,
    "billingEmail" TEXT,
    "phoneNumber" TEXT,
    "websiteUrl" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "townCity" TEXT,
    "county" TEXT,
    "eircode" TEXT,
    "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyMember" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "AgencyMemberRole" NOT NULL DEFAULT 'AGENT',
    "status" "AgencyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalContact" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "primaryEmail" TEXT,
    "phoneNumber" TEXT,
    "roles" "ProfessionalContactRole"[] DEFAULT ARRAY[]::"ProfessionalContactRole"[],
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ProfessionalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryProperty" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "eircode" TEXT,
    "propertyType" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "size" DOUBLE PRECISION,
    "sizeUnit" TEXT,
    "transactionType" "InventoryTransactionType" NOT NULL DEFAULT 'SALE',
    "stage" "InventoryStage" NOT NULL DEFAULT 'PROSPECT',
    "askingPrice" INTEGER,
    "valuationPrice" INTEGER,
    "assignedMemberId" INTEGER,
    "primaryContactId" INTEGER,
    "notes" TEXT,
    "appraisalDate" TIMESTAMP(3),
    "instructionDate" TIMESTAMP(3),
    "readyToListAt" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "saleAgreedDate" TIMESTAMP(3),
    "letAgreedDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyAuditLog" (
    "id" BIGSERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "actorUserId" INTEGER,
    "actorAgencyMemberId" INTEGER,
    "effectiveUserId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "changedFields" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_psraLicenceNumber_key" ON "Agency"("psraLicenceNumber");

-- CreateIndex
CREATE INDEX "Agency_name_idx" ON "Agency"("name");

-- CreateIndex
CREATE INDEX "Agency_status_idx" ON "Agency"("status");

-- CreateIndex
CREATE INDEX "Agency_primaryEmail_idx" ON "Agency"("primaryEmail");

-- CreateIndex
CREATE INDEX "Agency_billingEmail_idx" ON "Agency"("billingEmail");

-- CreateIndex
CREATE INDEX "Agency_createdByUserId_idx" ON "Agency"("createdByUserId");

-- CreateIndex
CREATE INDEX "Agency_updatedByUserId_idx" ON "Agency"("updatedByUserId");

-- CreateIndex
CREATE INDEX "AgencyMember_agencyId_idx" ON "AgencyMember"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyMember_userId_idx" ON "AgencyMember"("userId");

-- CreateIndex
CREATE INDEX "AgencyMember_role_idx" ON "AgencyMember"("role");

-- CreateIndex
CREATE INDEX "AgencyMember_status_idx" ON "AgencyMember"("status");

-- CreateIndex
CREATE INDEX "AgencyMember_agencyId_status_idx" ON "AgencyMember"("agencyId", "status");

-- CreateIndex
CREATE INDEX "AgencyMember_agencyId_role_idx" ON "AgencyMember"("agencyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyMember_agencyId_userId_key" ON "AgencyMember"("agencyId", "userId");

-- CreateIndex
CREATE INDEX "ProfessionalContact_agencyId_idx" ON "ProfessionalContact"("agencyId");

-- CreateIndex
CREATE INDEX "ProfessionalContact_primaryEmail_idx" ON "ProfessionalContact"("primaryEmail");

-- CreateIndex
CREATE INDEX "ProfessionalContact_phoneNumber_idx" ON "ProfessionalContact"("phoneNumber");

-- CreateIndex
CREATE INDEX "ProfessionalContact_isArchived_idx" ON "ProfessionalContact"("isArchived");

-- CreateIndex
CREATE INDEX "ProfessionalContact_agencyId_isArchived_idx" ON "ProfessionalContact"("agencyId", "isArchived");

-- CreateIndex
CREATE INDEX "ProfessionalContact_createdByUserId_idx" ON "ProfessionalContact"("createdByUserId");

-- CreateIndex
CREATE INDEX "ProfessionalContact_updatedByUserId_idx" ON "ProfessionalContact"("updatedByUserId");

-- CreateIndex
CREATE INDEX "InventoryProperty_agencyId_idx" ON "InventoryProperty"("agencyId");

-- CreateIndex
CREATE INDEX "InventoryProperty_stage_idx" ON "InventoryProperty"("stage");

-- CreateIndex
CREATE INDEX "InventoryProperty_transactionType_idx" ON "InventoryProperty"("transactionType");

-- CreateIndex
CREATE INDEX "InventoryProperty_assignedMemberId_idx" ON "InventoryProperty"("assignedMemberId");

-- CreateIndex
CREATE INDEX "InventoryProperty_primaryContactId_idx" ON "InventoryProperty"("primaryContactId");

-- CreateIndex
CREATE INDEX "InventoryProperty_createdByUserId_idx" ON "InventoryProperty"("createdByUserId");

-- CreateIndex
CREATE INDEX "InventoryProperty_updatedByUserId_idx" ON "InventoryProperty"("updatedByUserId");

-- CreateIndex
CREATE INDEX "InventoryProperty_agencyId_stage_idx" ON "InventoryProperty"("agencyId", "stage");

-- CreateIndex
CREATE INDEX "InventoryProperty_agencyId_assignedMemberId_idx" ON "InventoryProperty"("agencyId", "assignedMemberId");

-- CreateIndex
CREATE INDEX "InventoryProperty_updatedAt_idx" ON "InventoryProperty"("updatedAt");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_agencyId_idx" ON "AgencyAuditLog"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_actorUserId_idx" ON "AgencyAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_actorAgencyMemberId_idx" ON "AgencyAuditLog"("actorAgencyMemberId");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_effectiveUserId_idx" ON "AgencyAuditLog"("effectiveUserId");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_action_idx" ON "AgencyAuditLog"("action");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_entityType_idx" ON "AgencyAuditLog"("entityType");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_entityId_idx" ON "AgencyAuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_createdAt_idx" ON "AgencyAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_agencyId_createdAt_idx" ON "AgencyAuditLog"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_agencyId_actorUserId_createdAt_idx" ON "AgencyAuditLog"("agencyId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgencyAuditLog_agencyId_entityType_entityId_idx" ON "AgencyAuditLog"("agencyId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Property_agencyId_idx" ON "Property"("agencyId");

-- CreateIndex
CREATE INDEX "Property_inventoryPropertyId_idx" ON "Property"("inventoryPropertyId");

-- CreateIndex
CREATE INDEX "Property_createdByUserId_idx" ON "Property"("createdByUserId");

-- CreateIndex
CREATE INDEX "Property_updatedByUserId_idx" ON "Property"("updatedByUserId");

-- CreateIndex
CREATE INDEX "Property_agencyId_listingStatus_idx" ON "Property"("agencyId", "listingStatus");

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMember" ADD CONSTRAINT "AgencyMember_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMember" ADD CONSTRAINT "AgencyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalContact" ADD CONSTRAINT "ProfessionalContact_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalContact" ADD CONSTRAINT "ProfessionalContact_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalContact" ADD CONSTRAINT "ProfessionalContact_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProperty" ADD CONSTRAINT "InventoryProperty_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProperty" ADD CONSTRAINT "InventoryProperty_assignedMemberId_fkey" FOREIGN KEY ("assignedMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProperty" ADD CONSTRAINT "InventoryProperty_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "ProfessionalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProperty" ADD CONSTRAINT "InventoryProperty_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryProperty" ADD CONSTRAINT "InventoryProperty_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyAuditLog" ADD CONSTRAINT "AgencyAuditLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyAuditLog" ADD CONSTRAINT "AgencyAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyAuditLog" ADD CONSTRAINT "AgencyAuditLog_actorAgencyMemberId_fkey" FOREIGN KEY ("actorAgencyMemberId") REFERENCES "AgencyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyAuditLog" ADD CONSTRAINT "AgencyAuditLog_effectiveUserId_fkey" FOREIGN KEY ("effectiveUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_inventoryPropertyId_fkey" FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Protect the professional agency audit trail from mutation.
-- Audit records are append-only: they may be inserted and read,
-- but existing records may not be updated or deleted.
CREATE OR REPLACE FUNCTION "prevent_agency_audit_log_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AgencyAuditLog is append-only; existing audit records cannot be updated or deleted';
END;
$$;

CREATE TRIGGER "AgencyAuditLog_prevent_update"
BEFORE UPDATE ON "AgencyAuditLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agency_audit_log_mutation"();

CREATE TRIGGER "AgencyAuditLog_prevent_delete"
BEFORE DELETE ON "AgencyAuditLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agency_audit_log_mutation"();
