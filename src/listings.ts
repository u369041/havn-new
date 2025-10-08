// src/listings.ts
import { PrismaClient, ListingStatus, ListingType } from "@prisma/client";

const prisma = new PrismaClient();

/* ----------------------------- Types ----------------------------- */

export type ListQuery = {
  q?: string;
  city?: string;
  county?: string;
  status?: ListingStatus | "ALL";
  type?: ListingType;
  minPrice?: number;
  maxPrice?: number;
  page?: number; // 1-based
  pageSize?: number; // default 20
};

export type CreateImageInput = {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  format?: string;
  position?: number; // default 0..n
};

export type CreatePropertyInput = {
  title: string;
  description?: string;
  price: number;
  listingType: ListingType;
  status?: ListingStatus;
  bedrooms?: number;
  bathrooms?: number;
  areaSqFt?: number;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  county?: string;
  eircode?: string;
  latitude?: number;
  longitude?: number;
  slug: string;
  images?: CreateImageInput[];
};

/* --------------------------- Read/List --------------------------- */

export async function listProperties(query: ListQuery) {
  const {
    q,
    city,
    county,
    status = ListingStatus.ACTIVE,
    type,
    minPrice,
    maxPrice,
    page = 1,
    pageSize = 20,
  } = query;

  const where: any = {};

  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { county: { contains: q, mode: "insensitive" } },
      { eircode: { contains: q, mode: "insensitive" } },
    ];
  }
  if (city) where.city = { equals: city, mode: "insensitive" };
  if (county) where.county = { equals: county, mode: "insensitive" };
  if (type) where.listingType = type;
  if (status && status !== "ALL") where.status = status;
  if (minPrice != null || maxPrice != null) {
    where.price = {};
    if (minPrice != null) where.price.gte = Number(minPrice);
    if (maxPrice != null) where.price.lte = Number(maxPrice);
  }

  const skip = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  const take = Math.max(1, Math.min(100, pageSize));

  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      include: {
        images: {
          orderBy: { position: "asc" }, // position replaces sortOrder
        },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.property.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize: take,
    totalPages: Math.max(1, Math.ceil(total / take)),
  };
}

export async function getPropertyBySlug(slug: string) {
  return prisma.property.findUnique({
    where: { slug },
    include: {
      images: { orderBy: { position: "asc" } },
    },
  });
}

export async function getPropertyById(id: string) {
  return prisma.property.findUnique({
    where: { id },
    include: {
      images: { orderBy: { position: "asc" } },
    },
  });
}

/* --------------------------- Create/Update --------------------------- */

export async function createProperty(input: CreatePropertyInput) {
  const {
    images = [],
    listingType,
    status = ListingStatus.ACTIVE,
    ...rest
  } = input;

  // Ensure image positions are sequential
  const preparedImages = images.map((img, i) => ({
    url: img.url,
    publicId: img.publicId,
    width: img.width,
    height: img.height,
    format: img.format,
    position: img.position ?? i,
  }));

  return prisma.property.create({
    data: {
      ...rest,
      listingType, // NOTE: 'listingType' replaces old 'type'
      status,
      images: preparedImages.length
        ? { create: preparedImages }
        : undefined,
    },
    include: { images: { orderBy: { position: "asc" } } },
  });
}

export async function updatePropertyStatus(id: string, newStatus: ListingStatus) {
  return prisma.property.update({
    where: { id },
    data: { status: newStatus }, // correct enum type
  });
}

export async function updatePropertyCore(
  id: string,
  data: Partial<Omit<CreatePropertyInput, "images" | "slug">> & {
    slug?: string;
  }
) {
  // Prevent accidental wrong keys from old schema
  const { listingType, ...rest } = data as any;
  const updateData: any = { ...rest };
  if (listingType) updateData.listingType = listingType;

  return prisma.property.update({
    where: { id },
    data: updateData,
    include: { images: { orderBy: { position: "asc" } } },
  });
}

/* ---------------------------- Images API ---------------------------- */

export async function addPropertyImage(propertyId: string, image: CreateImageInput) {
  // create image and return ordered list
  await prisma.propertyImage.create({
    data: {
      propertyId,
      url: image.url,
      publicId: image.publicId,
      width: image.width,
      height: image.height,
      format: image.format,
      position: image.position ?? 0,
    },
  });

  return prisma.property.findUnique({
    where: { id: propertyId },
    include: { images: { orderBy: { position: "asc" } } },
  });
}

export async function deletePropertyImage(imageId: string) {
  return prisma.propertyImage.delete({ where: { id: imageId } });
}

export async function reorderImages(propertyId: string, orderedImageIds: string[]) {
  // Assign positions 0..n based on given order
  await prisma.$transaction(
    orderedImageIds.map((id, idx) =>
      prisma.propertyImage.update({
        where: { id },
        data: { position: idx },
      })
    )
  );

  return prisma.property.findUnique({
    where: { id: propertyId },
    include: { images: { orderBy: { position: "asc" } } },
  });
}
