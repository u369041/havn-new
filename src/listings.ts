// src/listings.ts
import { PrismaClient, Status } from "@prisma/client";

const prisma = new PrismaClient();

/** Make a simple, mostly-unique slug from a title */
function slugify(input: string) {
  const base = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

/**
 * List properties with optional filters & sorting.
 * Supports:
 *  - category: "SALE" | "RENT" | "SHARE"  (maps to type prefix)
 *  - subtype:  "HOUSE" | "APARTMENT" | "SITE" (maps to type suffix)
 *  - type:     exact string match, e.g., "SALE/HOUSE" (legacy)
 * sort: "price_asc" | "price_desc" | "date_desc" (default)
 */
export async function listProperties(opts: {
  category?: string;
  subtype?: string;
  type?: string;
  status?: keyof typeof Status | Status | string;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  take?: number;
  skip?: number;
  sort?: "price_asc" | "price_desc" | "date_desc";
}) {
  const o = opts || {};
  const where: any = {};

  // ----- Type filtering (category/subtype) -----
  const category = typeof o.category === "string" ? o.category.toUpperCase() : "";
  const subtype  = typeof o.subtype === "string"  ? o.subtype.toUpperCase()  : "";
  const exactType = typeof o.type === "string" ? o.type : "";

  if (exactType) {
    where.type = exactType;
  } else if (category && subtype) {
    where.type = `${category}/${subtype}`;
  } else if (category) {
    // e.g., "SALE/*"
    where.type = { startsWith: `${category}/` };
  } else if (subtype) {
    // e.g., "*/HOUSE"
    where.type = { endsWith: `/${subtype}` };
  }

  // ----- Other filters -----
  if (typeof o.beds === "number") {
    where.bedrooms = { gte: o.beds };
  }

  if (typeof o.minPrice === "number" || typeof o.maxPrice === "number") {
    where.price = {};
    if (typeof o.minPrice === "number") where.price.gte = o.minPrice;
    if (typeof o.maxPrice === "number") where.price.lte = o.maxPrice;
  }

  if (o.status) {
    const s = String(o.status).toUpperCase();
    if (s in Status) where.status = s;
  }

  // ----- Sorting & pagination -----
  let orderBy: any = [{ createdAt: "desc" }]; // default date_desc
  if (o.sort === "price_asc") orderBy = [{ price: "asc" }];
  if (o.sort === "price_desc") orderBy = [{ price: "desc" }];

  const take = typeof o.take === "number" ? o.take : 24;
  const skip = typeof o.skip === "number" ? o.skip : 0;

  const [count, properties] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      take,
      skip,
      orderBy,
      include: {
        images: { orderBy: { sortOrder: "asc" } },
      },
    }),
  ]);

  return { count, properties };
}

/** Get a single property by slug (with images ordered) */
export async function getPropertyBySlug(slug: string) {
  return prisma.property.findUnique({
    where: { slug },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
    },
  });
}

/**
 * Create a property from a mixed/legacy payload.
 * Accepts legacy keys: beds, baths and images: [{ publicId|public_id, url|secure_url }]
 */
export async function createProperty(payload: any) {
  const p = payload || {};
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const price =
    typeof p.price === "number"
      ? p.price
      : typeof p.price === "string"
      ? Number(p.price)
      : NaN;
  const type = typeof p.type === "string" ? p.type.trim() : "";

  if (!title) throw new Error("title is required");
  if (!Number.isFinite(price)) throw new Error("price must be a number");
  if (!type) throw new Error("type is required");

  const bedsNum =
    typeof p.beds === "number"
      ? p.beds
      : typeof p.beds === "string" && p.beds.trim()
      ? Number(p.beds)
      : null;

  const bathsNum =
    typeof p.baths === "number"
      ? p.baths
      : typeof p.baths === "string" && p.baths.trim()
      ? Number(p.baths)
      : null;

  const imagesArr: any[] = Array.isArray(p.images) ? p.images : [];

  const slug = slugify(title);

  return prisma.$transaction(async (tx) => {
    const created = await tx.property.create({
      data: {
        slug,
        title,
        status: "DRAFT",
        price,
        type,
        address: typeof p.address === "string" ? p.address : null,
        bedrooms: bedsNum,
        bathrooms: bathsNum,
        description:
          typeof p.description === "string" ? p.description : null,
        images: {
          create: imagesArr.map((im: any, idx: number) => ({
            publicId: String(im?.publicId || im?.public_id || ""),
            url: String(im?.url || im?.secure_url || ""),
            sortOrder: idx,
          })),
        },
      },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
      },
    });

    return created;
  });
}

/**
 * Update image order for a property.
 * Body should pass the desired order of image IDs.
 */
export async function setImageOrder(propertyId: string, imageIds: string[]) {
  if (!propertyId) throw new Error("propertyId is required");
  if (!Array.isArray(imageIds)) throw new Error("imageIds must be an array");

  await prisma.$transaction(
    imageIds.map((id: string, idx: number) =>
      prisma.image.update({
        where: { id },
        data: { sortOrder: idx },
      })
    )
  );

  return prisma.image.findMany({
    where: { propertyId },
    orderBy: { sortOrder: "asc" },
  });
}
