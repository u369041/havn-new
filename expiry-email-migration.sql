ALTER TABLE "Property"
ADD COLUMN "expiryWarningSentAt" TIMESTAMP(3),
ADD COLUMN "expiredEmailSentAt" TIMESTAMP(3);

CREATE INDEX "Property_expiryWarningSentAt_idx"
ON "Property"("expiryWarningSentAt");

CREATE INDEX "Property_expiredEmailSentAt_idx"
ON "Property"("expiredEmailSentAt");
