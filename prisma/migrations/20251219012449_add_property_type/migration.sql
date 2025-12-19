/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `propertyType` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `sizeUnits` on the `Property` table. All the data in the column will be lost.
  - Added the required column `propertytype` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Made the column `address1` on table `Property` required. This step will fail if there are existing NULL values in that column.
  - Made the column `city` on table `Property` required. This step will fail if there are existing NULL values in that column.
  - Made the column `county` on table `Property` required. This step will fail if there are existing NULL values in that column.
  - Made the column `price` on table `Property` required. This step will fail if there are existing NULL values in that column.
  - Made the column `status` on table `Property` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Property" DROP COLUMN "createdAt",
DROP COLUMN "propertyType",
DROP COLUMN "sizeUnits",
ADD COLUMN     "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "propertytype" TEXT NOT NULL,
ADD COLUMN     "sizeunits" TEXT,
ADD COLUMN     "userId" INTEGER,
ALTER COLUMN "address1" SET NOT NULL,
ALTER COLUMN "city" SET NOT NULL,
ALTER COLUMN "county" SET NOT NULL,
ALTER COLUMN "price" SET NOT NULL,
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "features" DROP DEFAULT,
ALTER COLUMN "photos" DROP DEFAULT;

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
