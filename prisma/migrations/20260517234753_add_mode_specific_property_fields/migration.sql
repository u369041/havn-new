-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "billsIncluded" TEXT,
ADD COLUMN     "couplesAllowed" TEXT,
ADD COLUMN     "currentOccupants" INTEGER,
ADD COLUMN     "ensuite" TEXT,
ADD COLUMN     "heatingType" TEXT,
ADD COLUMN     "leaseLength" TEXT,
ADD COLUMN     "minimumTerm" TEXT,
ADD COLUMN     "petsAllowed" TEXT,
ADD COLUMN     "roomType" TEXT,
ADD COLUMN     "saleCondition" TEXT,
ADD COLUMN     "viewingDetails" TEXT,
ADD COLUMN     "yearBuilt" INTEGER;
