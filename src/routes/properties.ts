import { Router, Request, Response } from "express";
import {
  PrismaClient,
  ListingType,
  ListingStatus,
  PropertyType,
  Prisma,
} from "@prisma/client";

export const apiRouter = Router();
const prisma = new PrismaClient();

/* ----------------------------- helpers ----------------------------- */

function toInt(val: any): number | undefined {
  if (val === undefined || val === null || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function toEnum<T extends string>(val: any, allowed: readonly T[]): T | undefined {
  if (typeof val !== "string") return undefined;
  const upper = val.toUpperCase();
  return allowed.includes(upper as T) ? (upper as T) : undefined;
}

/** Map request body -> Prisma.PropertyCreateInput (safe & typed) */
function mapCreateBody(
  body: any
): Prisma.PropertyCreateInput {
  const listingType = toEnum<ListingType>(body.listingType, [
    "SALE",
    "RENT",
  ] as const);

  const status = toEnum<ListingStatus>(body.status, [
    "ACTIVE",
    "DRAFT",
    "ARCHIVED",
  ] as const) ?? "ACTIVE";

  const propertyType = toEnum<PropertyType>(body.propertyType, [
    "DETACHED",
    "SEMI_D",
    "TERRACED",
    "APARTMENT",
    "OTHER",
  ] as const);

  const imagesArray: Prisma.PropertyImageCreateWithoutPropertyInput[] =
    Array.isArray(body.images)
      ? body.images
          .map((img: any) => ({
            url: String(img.url),
            publicId: img.publicId ? String(img.publicId) : undefined,
            width: img.width != null ? Number(img.width) : undefined,
            height: img.height != null ? Number(img.height) : undefined,
            format: img.format != null ? String(img.format) : undefined,
            position:
              img.position != null ? Number(img.position) : undefined,
          }))
          // keep only those with a url
          .filter((img) => !!img.url)
      : [];

  const data: Prisma.PropertyCreateInput = {
    slug: String(body.slug ?? ""),
    title: String(body.title ?? ""),
    description: body.description != null ? String(body.description) : "",
    price: toInt(body.price) ?? 0,

    // enums (optional)
    listingType: listingType,
    status: status,
    propertyType: propertyType,

    // numeric/optional fields
    bedrooms: toInt(body.bedrooms),
    bathrooms: toInt(body.bathrooms),
    areaSqFt: toInt(body.areaSqFt),
    addressLine1: body.addressLine1 ?? null,
    addressLine2: body.addressLine2 ?? null,
    city: body.city ?? null,
    county: body.county ?? null,
    eircode: body.eircode ?? null,
    latitude: body.latitude != null ? Number(body.latitude) : null,
    longitude: body.longitude != null ? Number(body.longitude) : null,

    images:
      imagesArray.length > 0
        ? {
            create: imagesArray,
          }
        : undefined,
  };

  return data;
}

/** Common select shape for list & detail */
const propertySelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  price: true,
  listingType: true,
  status: true,
  bedrooms: true,
  bathrooms: true,
  areaSqFt: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  county: true,
  eircode: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  updatedAt: true,
  propertyType: true,
  images: {
    select: {
      id: true,
      url: true,
      publicId: true,
      width: true,
      height: true,
      format: true,
      position: true,
    },
    orderBy: { position: "asc" as const },
  },
} satisfies Prisma.PropertySelect;

/* ------------------------------ routes ------------------------------ */

/**
 * GET /api/properties
 * Query params:
 *  - page (default 1)
 *  - pageSize (default 20)
 *  - q (search title/description/city/county/eircode)
 *  - minPrice / maxPrice
 *  - beds / baths
 *  - status (ACTIVE/DRAFT/ARCHIVED)
 *  - listingType (SALE/RENT)
 *  - propertyType (DETACHED/SEMI_D/TERRACED/APARTMENT/OTHER)
 */
apiRouter.get("/properties", async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, toInt(req.query.page) ?? 1);
    const pageSize = Math.min(100, Math.max(1, toInt(req.query.pageSize) ?? 20));

    const where: Prisma.PropertyWhereInput = {};

    const q = (req.query.q as string)?.trim();
    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
      ];
    }

    const minPrice = toInt(req.query.minPrice);
    const maxPrice = toInt(req.query.maxPrice);
    if (minPrice != null || maxPrice != null) {
      where.price = {
        gte: minPrice ?? undefined,
        lte: maxPrice ?? undefined,
      };
    }

    const beds = toInt(req.query.beds);
    if (beds != null) where.bedrooms = { gte: beds };

    const baths = toInt(req.query.baths);
    if (baths != null) where.bathrooms = { gte: baths };

    const status = toEnum<ListingStatus>(req.query.status, [
      "ACTIVE",
      "DRAFT",
      "ARCHIVED",
    ] as const);
    if (status) where.status = status;

    const listingType = toEnum<ListingType>(req.query.listingType, [
      "SALE",
      "RENT",
    ] as const);
    if (listingType) where.listingType = listingType;

    const propertyType = toEnum<PropertyType>(req.query.propertyType, [
      "DETACHED",
      "SEMI_D",
      "TERRACED",
      "APARTMENT",
      "OTHER",
    ] as const);
    if (propertyType) where.propertyType = propertyType;

    const [total, items] = await prisma.$transaction([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        select: propertySelect,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      ok: true,
      page,
      pageSize,
      total,
      items,
    });
  } catch (err: any) {
    console.error("GET /properties failed", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/** GET /api/properties/:id (detail) */
apiRouter.get("/properties/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const property = await prisma.property.findUnique({
      where: { id },
      select: propertySelect,
    });
    if (!property) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, property });
  } catch (err) {
    console.error("GET /properties/:id failed", err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

/** GET /api/properties/by-slug/:slug (detail by slug) */
apiRouter.get("/properties/by-slug/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const property = await prisma.property.findUnique({
      where: { slug },
      select: propertySelect,
    });
    if (!property) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, property });
  } catch (err) {
    console.error("GET /properties/by-slug failed", err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

/** POST /api/properties (create) */
apiRouter.post("/properties", async (req: Request, res: Response) => {
  try {
    const data = mapCreateBody(req.body);

    // minimal required fields
    if (!data.slug || !data.title) {
      return res.status(400).json({
        ok: false,
        error: "slug and title are required",
      });
    }

    const property = await prisma.property.create({
      data,
      select: propertySelect,
    });

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error("Create property failed:", err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});
