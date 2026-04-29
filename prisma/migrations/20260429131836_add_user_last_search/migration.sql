-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSearch" JSONB,
ADD COLUMN     "lastSearchAt" TIMESTAMP(3);
