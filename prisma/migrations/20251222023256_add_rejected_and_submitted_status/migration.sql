/*
  Warnings:

  - The values [PENDING] on the enum `ListingStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `revisionOfId` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `userId` on table `Property` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ListingStatus_new" AS ENUM ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'ARCHIVED');
ALTER TABLE "Property" ALTER COLUMN "listingStatus" DROP DEFAULT;
ALTER TABLE "Property" ALTER COLUMN "listingStatus" TYPE "ListingStatus_new" USING ("listingStatus"::text::"ListingStatus_new");
ALTER TYPE "ListingStatus" RENAME TO "ListingStatus_old";
ALTER TYPE "ListingStatus_new" RENAME TO "ListingStatus";
DROP TYPE "ListingStatus_old";
ALTER TABLE "Property" ALTER COLUMN "listingStatus" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_rejectedById_fkey";

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_revisionOfId_fkey";

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_userId_fkey";

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "revisionOfId",
DROP COLUMN "status",
ADD COLUMN     "marketStatus" TEXT,
ALTER COLUMN "features" DROP DEFAULT,
ALTER COLUMN "photos" DROP DEFAULT,
ALTER COLUMN "userId" SET NOT NULL;

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "UserRole";
