-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('COUNTRY', 'COUNTY', 'CITY', 'TOWN', 'VILLAGE', 'SUBURB', 'NEIGHBOURHOOD', 'LOCALITY', 'TOWNLAND', 'POSTAL_DISTRICT', 'SEARCH_REGION');

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "county" TEXT,
    "parentId" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eircodeRoutingKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "population" INTEGER,
    "searchable" BOOLEAN NOT NULL DEFAULT true,
    "indexable" BOOLEAN NOT NULL DEFAULT false,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "seoPriority" INTEGER NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "tailteId" TEXT,
    "csoId" TEXT,
    "osmId" TEXT,
    "geonamesId" TEXT,
    "sourceData" JSONB,
    "boundingBox" JSONB,
    "daftChecked" BOOLEAN NOT NULL DEFAULT false,
    "daftCheckedAt" TIMESTAMP(3),
    "daftNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE INDEX "Location_name_idx" ON "Location"("name");

-- CreateIndex
CREATE INDEX "Location_canonicalName_idx" ON "Location"("canonicalName");

-- CreateIndex
CREATE INDEX "Location_displayName_idx" ON "Location"("displayName");

-- CreateIndex
CREATE INDEX "Location_type_idx" ON "Location"("type");

-- CreateIndex
CREATE INDEX "Location_county_idx" ON "Location"("county");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Location_searchable_idx" ON "Location"("searchable");

-- CreateIndex
CREATE INDEX "Location_indexable_idx" ON "Location"("indexable");

-- CreateIndex
CREATE INDEX "Location_isPopular_idx" ON "Location"("isPopular");

-- CreateIndex
CREATE INDEX "Location_isActive_idx" ON "Location"("isActive");

-- CreateIndex
CREATE INDEX "Location_seoPriority_idx" ON "Location"("seoPriority");

-- CreateIndex
CREATE INDEX "Location_displayOrder_idx" ON "Location"("displayOrder");

-- CreateIndex
CREATE INDEX "Location_tailteId_idx" ON "Location"("tailteId");

-- CreateIndex
CREATE INDEX "Location_csoId_idx" ON "Location"("csoId");

-- CreateIndex
CREATE INDEX "Location_osmId_idx" ON "Location"("osmId");

-- CreateIndex
CREATE INDEX "Location_geonamesId_idx" ON "Location"("geonamesId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
