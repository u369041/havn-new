-- AlterTable
ALTER TABLE "SavedSearch" ADD COLUMN     "alertFrequency" TEXT NOT NULL DEFAULT 'weekly',
ADD COLUMN     "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastDigestAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SavedSearch_lastDigestAt_idx" ON "SavedSearch"("lastDigestAt");
