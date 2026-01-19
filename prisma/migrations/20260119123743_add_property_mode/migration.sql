/*
  Warnings:

  - You are about to drop the column `rejectionReason` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `revisionOfId` on the `Property` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[emailVerifyToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MarketMode" AS ENUM ('BUY', 'RENT', 'SHARE');

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "rejectionReason",
DROP COLUMN "revisionOfId",
ADD COLUMN     "mode" "MarketMode" NOT NULL DEFAULT 'BUY',
ADD COLUMN     "rejectedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailVerifyToken" TEXT,
ADD COLUMN     "emailVerifyTokenExp" TIMESTAMP(3),
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "loginCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Property_mode_idx" ON "Property"("mode");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON "User"("emailVerifyToken");
