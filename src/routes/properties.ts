// src/routes/properties.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import slugify from "slugify";

const prisma = new PrismaClient();
const router = Router();

/**
 * Utility: coerce a string or string[] from req.query to string | undefined
 */
function qstr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
}

/**
 * GET /api/properties
 * Optional query params:
 *  - q           (search in title/description/city/county/eircode)
 *  - type        (ListingType enum value in DB, e.g. "SALE" | "RENT")
 *  - status      (ListingStatus enum value in DB, e.g. "ACTIVE")
 *  - minPrice    (number)
 *  - maxPrice    (number)
 */
router.get("/properties", async (req, res) => {
  try {
    const q = qstr(req.query.q);
    const type = qstr(req.query.type);
    const status = qstr(req.query.status);

    const minPrice =
      typeof req.query.minPrice === "string"
        ? Number(req.query.minPrice)
        : undefined;
    const maxPrice =
      typeof req.query.maxPrice === "string"
        ? Number(req.query.maxPrice)
        : undefined;

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

    if (type) where.listingType = type; // must match your Prisma enum values
    if (status) where.status = status;  // must match your Prisma enum values

    if (Number.isFinite(minPrice) || Number.isFinite(maxPrice)) {
      where.price = {};
      if (Number.isFinite(minPrice)) where.price.gte = minPrice;
      if (Number.isFinite(maxPrice)) where.price.lte = maxPrice;
    }

    const properties = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { position: "asc" },
        },
      },
    });

    return res.json({
      ok: true,
      count: properties.length,
      properties,
    });
  } catch (err: any) {
    console.error("GET /properties error", err);
    return res.status(500).json({ ok: false, error: err.message ?? "Error" });
  }
});

/**
 * GET /api/properties/:slug
 */
router.get("/properties/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const property = await prisma.property.findUnique({
      where: { slug },
      include: {
        images: {
          orderBy: { position: "asc" },
        },
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    return res.json({ ok: true, property });
  } catch (err: any) {
    console.error("GET /properties/:slug error", err);
    return res.status(500).json({ ok: false, error: err.message ?? "Error" });
  }
});

/**
 * POST /api/properties
 * Body example:
 * {
 *   "title": "Test Property",
 *   "description": "Demo listing",
 *   "price": 250000,
 *   "listingType": "SALE",
 *   "status": "ACTIVE",
 *   "bedrooms": 2,
 *   "bathrooms": 1,
 *   "addressLine1": "10 Abbey Court",
 *   "addressLine2": null,
 *   "city": "Dublin",
 *   "county": "Dublin",
 *   "eircode": "A94YD62",
 *   "slug": "optional-custom-slug",
 *   "images": [
 *     {
 *       "url": "https://res.cloudinary.com/demo/image/upload/sample.jpg",
 *       "publicId": "manual-test",
 *       "width": null,
 *       "height": null,
 *       "format": "jpg",
 *       "position": 0
 *     }
 *   ]
 * }
 *
 * NOTE: No reference to sizeSqM (or other non-existent columns).
 */
router.post("/properties", async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      listingType,
      status,
      bedrooms,
      bathrooms,
      addressLine1,
      addressLine2,
      city,
      county,
      eircode,
      slug,
      images,
    } = req.body ?? {};

    if (!title || !price || !listingType || !status) {
      return res.status(400).json({
        ok: false,
        error:
          "Missing required fields: title, price, listingType, status are required",
      });
    }

    const finalSlug =
      typeof slug === "string" && slug.trim().length > 0
        ? slug.trim()
        : `${slugify(title, { lower: true, strict: true })}-${Date.now()
            .toString()
            .slice(-6)}`;

    const created = await prisma.property.create({
      data: {
        title,
        description: description ?? null,
        price: Number(price),
        listingType, // must match your Prisma enum values
        status, // must match your Prisma enum values
        bedrooms: bedrooms ?? null,
        bathrooms: bathrooms ?? null,
        addressLine1: addressLine1 ?? null,
        addressLine2: addressLine2 ?? null,
        city: city ?? null,
        county: county ?? null,
        eircode: eircode ?? null,
        slug: finalSlug,
        images:
          Array.isArray(images) && images.length > 0
            ? {
                create: images.map((img: any, index: number) => ({
                  url: img?.url,
                  publicId: img?.publicId ?? null,
                  width:
                    typeof img?.width === "number" ? img.width : null,
                  height:
                    typeof img?.height === "number" ? img.height : null,
                  format: img?.format ?? null,
                  position:
                    typeof img?.position === "number" ? img.position : index,
                })),
              }
            : undefined,
      },
      include: {
        images: {
          orderBy: { position: "asc" },
        },
      },
    });

    return res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error("POST /properties error", err);
    return res.status(500).json({ ok: false, error: err.message ?? "Error" });
  }
});

export default router;
