-- AlterTable
ALTER TABLE "User" ADD COLUMN     "listingEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "productEmailsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "savedSearchEmailsEnabled" BOOLEAN NOT NULL DEFAULT true;
