-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'VIEWING_BOOKED', 'OFFER_IN_PROGRESS', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "internalNote" TEXT,
ADD COLUMN     "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "statusUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Enquiry_status_idx" ON "Enquiry"("status");
