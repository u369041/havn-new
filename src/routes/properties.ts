// src/routes/properties.ts

import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";
import slugify from "slugify";

const router = Router();
const prisma = new PrismaClient();

/** Helper: build a unique slug (appends -2, -3, ... if needed) */
async function uniqueSlugFromTitle(title: string) {
  let base = slugify(title ?? "", { lower: true, strict: true }) || "listing";
  let candidate = base;
  let i = 2;
  while (true) {
    const exists = await prisma.property.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
    candidate = `${base}-${i++}`;
  }
}

/**
 * GET /api/properties
 * Optional query params:
 *  - city
 *  - county
 *  - listingType = RENT | SALE | SHARE
 *  - status = DRAFT | ACTIVE | ARCHIVED
 *  - minPrice, maxPrice
 *  - take (default 20)
 *  - skip (default 0)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const take = Number(req.query.take ?? 20);
    const skip = Number(req.query.skip ?? 0);

    const listingType = req.query.listingType
      ? String(req.query.listingType).toUpperCase()
      : undefined;
    const status = req.query.status
      ? String(req.query.status).toUpperCase()
      : undefined;

    const minPrice =
      req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPrice =
      req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;

    const priceFilter =
      minPrice !== undefined || maxPrice !== undefined
        ? {
            gte: Number.isFinite(minPrice) ? minPrice : undefined,
            lte: Number.isFinite(maxPrice) ? maxPrice : undefined,
          }
        : undefined;

    const filters: any = {
      city: req.query.city ? String(req.query.city) : undefined,
      county: req.query.county ? String(req.query.county) : undefined,
      listingType:
        listingType && ["RENT", "SALE", "SHARE"].includes(listingType)
          ? (listingType as ListingType)
          : undefined,
      status:
        status && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(status)
          ? (status as ListingStatus)
          : undefined,
      price: priceFilter,
    };

    const properties = await prisma.property.findMany({
      where: filters,
      include: { images: true },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error("GET /api/properties error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/**
 * GET /api/properties/:id
 * Fetch single property by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const property = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: { images: true },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error("GET /api/properties/:id error:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

/**
 * POST /api/properties
 * Expected body:
 * {
 *   title, description, price, listingType, bedrooms?, bathrooms?, areaSqFt?,
 *   addressLine1?, addressLine2?, city?, county?, eircode?,
 *   latitude?, longitude?,
 *   images?: [{ publicId, url, width?, height?, format? }]
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      listingType,
      status, // optional
      bedrooms,
      bathrooms,
      areaSqFt,
      addressLine1,
      addressLine2,
      city,
      county,
      eircode,
      latitude,
      longitude,
      images,
    } = req.body ?? {};

    // Basic validation
    if (!title || typeof title !== "string") {
      return res.status(400).json({ ok: false, error: "title is required" });
    }
    if (price === undefined || price === null || isNaN(Number(price))) {
      return res.status(400).json({ ok: false, error: "price must be a number" });
    }
    const lt = String(listingType ?? "").toUpperCase();
    if (!["RENT", "SALE", "SHARE"].includes(lt)) {
      return res
        .status(400)
        .json({ ok: false, error: "listingType must be RENT, SALE, or SHARE" });
    }

    // Generate a unique slug
    const slug = await uniqueSlugFromTitle(title);

    const created = await prisma.property.create({
      data: {
        title,
        description: description ?? "",
        price: Number(price),
        listingType: lt as ListingType,
        status:
          status && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(String(status).toUpperCase())
            ? (String(status).toUpperCase() as ListingStatus)
            : undefined, // falls back to model default (ACTIVE)
        bedrooms: bedrooms === undefined ? undefined : Number(bedrooms),
        bathrooms: bathrooms === undefined ? undefined : Number(bathrooms),
        areaSqFt: areaSqFt === undefined ? undefined : Number(areaSqFt),
        addressLine1: addressLine1 ?? undefined,
        addressLine2: addressLine2 ?? undefined,
        city: city ?? undefined,
        county: county ?? undefined,
        eircode: eircode ?? undefined,
        latitude: latitude === undefined ? undefined : Number(latitude),
        longitude: longitude === undefined ? undefined : Number(longitude),
        slug,
        images: images?.length
          ? {
              create: (images as any[]).map((img, index) => ({
                publicId: String(img.publicId),
                url: String(img.url),
                width: img.width === undefined ? undefined : Number(img.width),
                height: img.height === undefined ? undefined : Number(img.height),
                format: img.format ? String(img.format) : undefined,
                position: index,
              })),
            }
          : undefined,
      },
      include: { images: true },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err) {
    console.error("POST /api/properties error:", err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
