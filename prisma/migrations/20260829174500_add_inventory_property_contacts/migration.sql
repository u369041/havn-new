-- CreateEnum
CREATE TYPE "InventoryContactNotificationLevel" AS ENUM ('OFF', 'MAJOR_ONLY', 'MEDIUM_AND_MAJOR');

-- CreateTable
CREATE TABLE "InventoryPropertyContact" (
    "id" SERIAL NOT NULL,
    "agencyId" INTEGER NOT NULL,
    "inventoryPropertyId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "relationshipLabel" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notificationLevel" "InventoryContactNotificationLevel" NOT NULL DEFAULT 'OFF',
    "createdByUserId" INTEGER,
    "updatedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryPropertyContact_pkey" PRIMARY KEY ("id")
);

-- Existing single primary contacts become CRM/property links.
INSERT INTO "InventoryPropertyContact" (
    "agencyId",
    "inventoryPropertyId",
    "contactId",
    "relationshipLabel",
    "isPrimary",
    "notificationLevel",
    "createdByUserId",
    "updatedByUserId",
    "createdAt",
    "updatedAt"
)
SELECT
    ip."agencyId",
    ip."id",
    ip."primaryContactId",
    'Primary contact',
    true,
    'OFF'::"InventoryContactNotificationLevel",
    ip."createdByUserId",
    ip."updatedByUserId",
    COALESCE(ip."createdAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
FROM "InventoryProperty" ip
JOIN "ProfessionalContact" pc
  ON pc."id" = ip."primaryContactId"
 AND pc."agencyId" = ip."agencyId"
WHERE ip."primaryContactId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryPropertyContact_inventoryPropertyId_contactId_key"
ON "InventoryPropertyContact"("inventoryPropertyId", "contactId");

CREATE INDEX "InventoryPropertyContact_agencyId_idx"
ON "InventoryPropertyContact"("agencyId");

CREATE INDEX "InventoryPropertyContact_inventoryPropertyId_idx"
ON "InventoryPropertyContact"("inventoryPropertyId");

CREATE INDEX "InventoryPropertyContact_contactId_idx"
ON "InventoryPropertyContact"("contactId");

CREATE INDEX "InventoryPropertyContact_agencyId_archivedAt_idx"
ON "InventoryPropertyContact"("agencyId", "archivedAt");

CREATE INDEX "InventoryPropertyContact_inventoryPropertyId_archivedAt_idx"
ON "InventoryPropertyContact"("inventoryPropertyId", "archivedAt");

CREATE INDEX "InventoryPropertyContact_contactId_archivedAt_idx"
ON "InventoryPropertyContact"("contactId", "archivedAt");

CREATE INDEX "InventoryPropertyContact_createdByUserId_idx"
ON "InventoryPropertyContact"("createdByUserId");

CREATE INDEX "InventoryPropertyContact_updatedByUserId_idx"
ON "InventoryPropertyContact"("updatedByUserId");

-- At most one active primary CRM contact link per Inventory property.
CREATE UNIQUE INDEX "InventoryPropertyContact_one_active_primary_per_property"
ON "InventoryPropertyContact"("inventoryPropertyId")
WHERE "isPrimary" = true AND "archivedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "InventoryPropertyContact"
ADD CONSTRAINT "InventoryPropertyContact_agencyId_fkey"
FOREIGN KEY ("agencyId") REFERENCES "Agency"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryPropertyContact"
ADD CONSTRAINT "InventoryPropertyContact_inventoryPropertyId_fkey"
FOREIGN KEY ("inventoryPropertyId") REFERENCES "InventoryProperty"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryPropertyContact"
ADD CONSTRAINT "InventoryPropertyContact_contactId_fkey"
FOREIGN KEY ("contactId") REFERENCES "ProfessionalContact"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryPropertyContact"
ADD CONSTRAINT "InventoryPropertyContact_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryPropertyContact"
ADD CONSTRAINT "InventoryPropertyContact_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
