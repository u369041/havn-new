import type {
  InventoryMedia,
  InventoryProperty,
  Prisma,
  Property,
} from "@prisma/client";

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
  | "transactionType"
  | "askingPrice"
  | "listingTitle"
  | "description"
  | "features"
  | "berRating"
  | "berNo"
  | "parking"
  | "outdoorSpace"
  | "saleCondition"
  | "yearBuilt"
  | "heatingType"
  | "viewingDetails"
  | "rentFrequency"
  | "deposit"
  | "availableFrom"
  | "furnished"
  | "leaseLength"
  | "minimumTerm"
  | "billsIncluded"
  | "petsAllowed"
  | "roomType"
  | "ensuite"
  | "currentOccupants"
  | "couplesAllowed"
  | "ownerOccupied"
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
  | "mode"
  | "price"
  | "title"
  | "description"
  | "features"
  | "ber"
  | "berRating"
  | "berNo"
  | "parking"
  | "outdoorSpace"
  | "saleCondition"
  | "yearBuilt"
  | "heatingType"
  | "viewingDetails"
  | "rentFrequency"
  | "deposit"
  | "availableFrom"
  | "furnished"
  | "leaseLength"
  | "minimumTerm"
  | "billsIncluded"
  | "petsAllowed"
  | "roomType"
  | "ensuite"
  | "currentOccupants"
  | "couplesAllowed"
  | "ownerOccupied"
>;

type PublicInventoryMediaSource = Pick<
  InventoryMedia,
  | "id"
  | "kind"
  | "source"
  | "visibility"
  | "url"
  | "thumbnailUrl"
  | "resourceType"
  | "format"
  | "mimeType"
  | "originalFilename"
  | "bytes"
  | "width"
  | "height"
  | "duration"
  | "title"
  | "caption"
  | "category"
  | "position"
  | "isCover"
  | "externalProvider"
>;

export type InventoryListingMediaSnapshot = {
  photos: string[];
  photoMeta: Prisma.InputJsonValue;
  presentationMedia: Prisma.InputJsonValue;
};

export function inventoryMediaToListingSnapshot(
  media: PublicInventoryMediaSource[],
): InventoryListingMediaSnapshot {
  const eligible = media
    .filter((item) => item.visibility === "LISTING_ELIGIBLE")
    .sort((left, right) => left.position - right.position || left.id - right.id);

  const images = eligible
    .filter((item) => item.kind === "IMAGE")
    .sort(
      (left, right) =>
        Number(right.isCover) - Number(left.isCover) ||
        left.position - right.position ||
        left.id - right.id,
    );

  const photos = images.map((item) => item.url);
  const photoMeta = {
    version: "inventory-media-v1",
    source: "agency_inventory",
    updatedAt: new Date().toISOString(),
    photos: images.map((item, index) => ({
      url: item.url,
      index,
      category: item.category || "",
      caption: item.caption || "",
      source: "agency_inventory",
      confidence: 1,
      isCover: index === 0,
      inventoryMediaId: item.id,
    })),
  } satisfies Prisma.InputJsonObject;

  const presentationMedia = eligible
    .filter((item) => item.kind !== "IMAGE")
    .map((item) => ({
      inventoryMediaId: item.id,
      kind: item.kind,
      source: item.source,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl,
      resourceType: item.resourceType,
      format: item.format,
      mimeType: item.mimeType,
      originalFilename: item.originalFilename,
      bytes: item.bytes,
      width: item.width,
      height: item.height,
      duration: item.duration,
      title: item.title,
      caption: item.caption,
      category: item.category,
      position: item.position,
      externalProvider: item.externalProvider,
    })) satisfies Prisma.InputJsonArray;

  return { photos, photoMeta, presentationMedia };
}

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
    mode:
      inventory.transactionType === "SHARE"
        ? "SHARE"
        : inventory.transactionType === "RENTAL"
          ? "RENT"
          : "BUY",
    price: inventory.askingPrice ?? 0,
    title:
      inventory.listingTitle ||
      [inventory.address1, inventory.city, inventory.county]
        .filter(Boolean)
        .join(", "),
    description: inventory.description,
    features: inventory.features,
    ber: inventory.berRating,
    berRating: inventory.berRating,
    berNo: inventory.berNo,
    parking: inventory.parking,
    outdoorSpace: inventory.outdoorSpace,
    saleCondition: inventory.saleCondition,
    yearBuilt: inventory.yearBuilt,
    heatingType: inventory.heatingType,
    viewingDetails: inventory.viewingDetails,
    rentFrequency: inventory.rentFrequency,
    deposit: inventory.deposit,
    availableFrom: inventory.availableFrom,
    furnished: inventory.furnished,
    leaseLength: inventory.leaseLength,
    minimumTerm: inventory.minimumTerm,
    billsIncluded: inventory.billsIncluded,
    petsAllowed: inventory.petsAllowed,
    roomType: inventory.roomType,
    ensuite: inventory.ensuite,
    currentOccupants: inventory.currentOccupants,
    couplesAllowed: inventory.couplesAllowed,
    ownerOccupied: inventory.ownerOccupied,
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
    transactionType:
      property.mode === "SHARE"
        ? "SHARE"
        : property.mode === "RENT"
          ? "RENTAL"
          : "SALE",
    askingPrice: property.price,
    listingTitle: property.title,
    description: property.description,
    features: property.features,
    berRating: property.berRating || property.ber,
    berNo: property.berNo,
    parking: property.parking,
    outdoorSpace: property.outdoorSpace,
    saleCondition: property.saleCondition,
    yearBuilt: property.yearBuilt,
    heatingType: property.heatingType,
    viewingDetails: property.viewingDetails,
    rentFrequency: property.rentFrequency,
    deposit: property.deposit,
    availableFrom: property.availableFrom,
    furnished: property.furnished,
    leaseLength: property.leaseLength,
    minimumTerm: property.minimumTerm,
    billsIncluded: property.billsIncluded,
    petsAllowed: property.petsAllowed,
    roomType: property.roomType,
    ensuite: property.ensuite,
    currentOccupants: property.currentOccupants,
    couplesAllowed: property.couplesAllowed,
    ownerOccupied: property.ownerOccupied,
  };
}
