/*
  Warnings:

  - A unique constraint covering the columns `[googleId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[appleId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "appleEmail" TEXT,
ADD COLUMN     "appleId" TEXT,
ADD COLUMN     "appleLinkedAt" TIMESTAMP(3),
ADD COLUMN     "googleEmail" TEXT,
ADD COLUMN     "googleId" TEXT,
ADD COLUMN     "googleLinkedAt" TIMESTAMP(3),
ADD COLUMN     "lastAuthProvider" TEXT,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_appleId_key" ON "User"("appleId");
