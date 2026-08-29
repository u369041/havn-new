-- Add a moderated public-listing snapshot of Inventory media.
-- Only LISTING_ELIGIBLE InventoryMedia records are copied into this field.
ALTER TABLE "Property" ADD COLUMN "presentationMedia" JSONB;
