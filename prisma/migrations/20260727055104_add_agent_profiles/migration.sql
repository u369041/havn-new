-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'agent';

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "townCity" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "eircode" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "psraLicenceNumber" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "declarationAcceptedAt" TIMESTAMP(3) NOT NULL,
    "psraVerified" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectedReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedById" INTEGER,
    "suspensionReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "internalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_userId_key" ON "AgentProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_psraLicenceNumber_key" ON "AgentProfile"("psraLicenceNumber");

-- CreateIndex
CREATE INDEX "AgentProfile_status_idx" ON "AgentProfile"("status");

-- CreateIndex
CREATE INDEX "AgentProfile_companyName_idx" ON "AgentProfile"("companyName");

-- CreateIndex
CREATE INDEX "AgentProfile_submittedAt_idx" ON "AgentProfile"("submittedAt");

-- CreateIndex
CREATE INDEX "AgentProfile_approvedAt_idx" ON "AgentProfile"("approvedAt");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_suspendedById_fkey" FOREIGN KEY ("suspendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
