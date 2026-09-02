-- AlterTable
ALTER TABLE "ProfessionalContact" ADD COLUMN     "companyId" INTEGER;

-- CreateTable
CREATE TABLE "CrmCompany" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phoneNumber" TEXT,
    "websiteUrl" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "townCity" TEXT,
    "county" TEXT,
    "eircode" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CrmCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmFollowUp" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmCompany_agencyId_idx" ON "CrmCompany"("agencyId");

-- CreateIndex
CREATE INDEX "CrmCompany_name_idx" ON "CrmCompany"("name");

-- CreateIndex
CREATE INDEX "CrmCompany_email_idx" ON "CrmCompany"("email");

-- CreateIndex
CREATE INDEX "CrmCompany_phoneNumber_idx" ON "CrmCompany"("phoneNumber");

-- CreateIndex
CREATE INDEX "CrmCompany_isArchived_idx" ON "CrmCompany"("isArchived");

-- CreateIndex
CREATE INDEX "CrmCompany_agencyId_isArchived_idx" ON "CrmCompany"("agencyId", "isArchived");

-- CreateIndex
CREATE INDEX "CrmNote_agencyId_idx" ON "CrmNote"("agencyId");

-- CreateIndex
CREATE INDEX "CrmNote_contactId_idx" ON "CrmNote"("contactId");

-- CreateIndex
CREATE INDEX "CrmNote_createdAt_idx" ON "CrmNote"("createdAt");

-- CreateIndex
CREATE INDEX "CrmNote_agencyId_createdAt_idx" ON "CrmNote"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmNote_contactId_createdAt_idx" ON "CrmNote"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmFollowUp_agencyId_idx" ON "CrmFollowUp"("agencyId");

-- CreateIndex
CREATE INDEX "CrmFollowUp_contactId_idx" ON "CrmFollowUp"("contactId");

-- CreateIndex
CREATE INDEX "CrmFollowUp_dueAt_idx" ON "CrmFollowUp"("dueAt");

-- CreateIndex
CREATE INDEX "CrmFollowUp_completedAt_idx" ON "CrmFollowUp"("completedAt");

-- CreateIndex
CREATE INDEX "CrmFollowUp_agencyId_dueAt_idx" ON "CrmFollowUp"("agencyId", "dueAt");

-- CreateIndex
CREATE INDEX "CrmFollowUp_contactId_dueAt_idx" ON "CrmFollowUp"("contactId", "dueAt");

-- CreateIndex
CREATE INDEX "ProfessionalContact_companyId_idx" ON "ProfessionalContact"("companyId");

-- AddForeignKey
ALTER TABLE "ProfessionalContact" ADD CONSTRAINT "ProfessionalContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CrmCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmCompany" ADD CONSTRAINT "CrmCompany_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmFollowUp" ADD CONSTRAINT "CrmFollowUp_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
