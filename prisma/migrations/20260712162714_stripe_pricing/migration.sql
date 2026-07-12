CREATE TYPE "ListingPackage" AS ENUM ('STANDARD', 'FEATURED');

CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

ALTER TABLE "User"
ADD COLUMN "foundingOfferUsedAt" TIMESTAMP(3);

ALTER TABLE "Property"
ADD COLUMN "listingPackage" "ListingPackage",
ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN "stripeCheckoutSessionId" TEXT,
ADD COLUMN "stripePaymentIntentId" TEXT,
ADD COLUMN "amountPaidCents" INTEGER,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "listingExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Property_stripeCheckoutSessionId_key"
ON "Property"("stripeCheckoutSessionId");

CREATE INDEX "Property_listingPackage_idx"
ON "Property"("listingPackage");

CREATE INDEX "Property_paymentStatus_idx"
ON "Property"("paymentStatus");

CREATE INDEX "Property_listingExpiresAt_idx"
ON "Property"("listingExpiresAt");
