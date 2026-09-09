CREATE TYPE "InventoryPropertyContactRelationshipType" AS ENUM (
  'VENDOR',
  'PROSPECTIVE_BUYER',
  'BUYER',
  'LANDLORD',
  'TENANT',
  'SOLICITOR',
  'SURVEYOR',
  'BER_ASSESSOR',
  'CONTRACTOR',
  'BROKER',
  'OTHER'
);

ALTER TABLE "InventoryPropertyContact"
ADD COLUMN "relationshipType" "InventoryPropertyContactRelationshipType";

CREATE INDEX "InventoryPropertyContact_relationshipType_idx"
ON "InventoryPropertyContact"("relationshipType");
