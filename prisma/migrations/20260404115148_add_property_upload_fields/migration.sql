-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "berRating" TEXT,
ADD COLUMN     "deposit" INTEGER,
ADD COLUMN     "furnished" BOOLEAN,
ADD COLUMN     "outdoorSpace" TEXT,
ADD COLUMN     "parking" TEXT,
ADD COLUMN     "rentFrequency" TEXT,
ADD COLUMN     "size" DOUBLE PRECISION,
ADD COLUMN     "sizeUnit" TEXT;
