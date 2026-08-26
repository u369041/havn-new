import type { InventoryProperty, Prisma, Property } from "@prisma/client";

type InventoryDraftSyncSource = Pick<
  InventoryProperty,
  | "address1"
  | "address2"
  | "city"
  | "county"
  | "eircode"
  | "propertyType"
  | "bedrooms"
  | "bathrooms"
  | "size"
  | "sizeUnit"
>;

type PropertyInventorySyncSource = Pick<
  Property,
  | "address1"
  | "address2"
  | "city"
  | "county"
  | "eircode"
  | "propertyType"
  | "bedrooms"
  | "bathrooms"
  | "size"
  | "sizeUnit"
>;

export function inventoryToDraftListingData(
  inventory: InventoryDraftSyncSource,
): Prisma.PropertyUncheckedUpdateInput {
  return {
    address1: inventory.address1,
    address2: inventory.address2,
    city: inventory.city,
    county: inventory.county,
    eircode: inventory.eircode,
    propertyType: inventory.propertyType,
    bedrooms: inventory.bedrooms,
    bathrooms: inventory.bathrooms,
    size: inventory.size,
    sizeUnit: inventory.sizeUnit,
  };
}

export function draftListingToInventoryData(
  property: PropertyInventorySyncSource,
): Prisma.InventoryPropertyUncheckedUpdateInput {
  return {
    address1: property.address1,
    address2: property.address2,
    city: property.city,
    county: property.county,
    eircode: property.eircode,
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    size: property.size,
    sizeUnit: property.sizeUnit,
  };
}
