-- CreateTable
CREATE TABLE "Property" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "eircode" TEXT,
    "price" DOUBLE PRECISION,
    "status" TEXT,
    "propertyType" TEXT,
    "ber" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "size" DOUBLE PRECISION,
    "sizeUnits" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");
