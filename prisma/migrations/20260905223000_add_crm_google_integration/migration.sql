-- CreateEnum
CREATE TYPE "CrmIntegrationProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- CreateEnum
CREATE TYPE "CrmIntegrationStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "CrmIntegrationConnection" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "CrmIntegrationProvider" NOT NULL,
    "status" "CrmIntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
    "accountEmail" TEXT,
    "externalAccountId" TEXT,
    "scopes" TEXT[],
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "gmailHistoryId" TEXT,
    "calendarSyncToken" TEXT,
    "lastEmailSyncAt" TIMESTAMP(3),
    "lastCalendarSyncAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "CrmIntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmIntegrationConnection_agencyId_memberId_provider_key" ON "CrmIntegrationConnection"("agencyId", "memberId", "provider");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_agencyId_idx" ON "CrmIntegrationConnection"("agencyId");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_memberId_idx" ON "CrmIntegrationConnection"("memberId");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_userId_idx" ON "CrmIntegrationConnection"("userId");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_provider_idx" ON "CrmIntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_status_idx" ON "CrmIntegrationConnection"("status");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_accountEmail_idx" ON "CrmIntegrationConnection"("accountEmail");

-- CreateIndex
CREATE INDEX "CrmIntegrationConnection_agencyId_status_idx" ON "CrmIntegrationConnection"("agencyId", "status");

-- AddForeignKey
ALTER TABLE "CrmIntegrationConnection" ADD CONSTRAINT "CrmIntegrationConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmIntegrationConnection" ADD CONSTRAINT "CrmIntegrationConnection_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "AgencyMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmIntegrationConnection" ADD CONSTRAINT "CrmIntegrationConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
