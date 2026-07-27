-- Reconciliation migration.
-- These fields already exist in Neon but were missing from local migration history.

ALTER TABLE "User"
ADD COLUMN "pendingEmail" TEXT,
ADD COLUMN "emailChangeTokenHash" TEXT,
ADD COLUMN "emailChangeTokenExp" TIMESTAMP(3),
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_pendingEmail_key" ON "User"("pendingEmail");
CREATE UNIQUE INDEX "User_emailChangeTokenHash_key" ON "User"("emailChangeTokenHash");
