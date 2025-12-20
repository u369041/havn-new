/*
  Warnings:

  - You are about to drop the column `createdat` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `propertytype` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `size` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `sizeunits` on the `Property` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `Property` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Added the required column `propertyType` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Property` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "createdat",
DROP COLUMN "propertytype",
DROP COLUMN "size",
DROP COLUMN "sizeunits",
ADD COLUMN     "berNo" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "propertyType" TEXT NOT NULL,
ADD COLUMN     "saleType" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "price" SET DATA TYPE INTEGER,
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "features" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "photos" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'user';
