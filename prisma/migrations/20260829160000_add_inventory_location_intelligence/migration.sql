ALTER TABLE "InventoryProperty"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "intelligence" JSONB,
  ADD COLUMN "intelligenceUpdatedAt" TIMESTAMP(3);
