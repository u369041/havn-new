// src/listings.ts

import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus, PropertyType } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * Build where clause from query params
 */
function buildWhere(q: any) {
  const where: any = {
    // text search across a few columns
    OR: [],
  };

  const text = (q.q || "").trim();
  if (text) {
    where.OR.push(
      { title: { contains: text, mode: "insensitive" } },
      { description: { contains: text, mode: "insensitive" } },
      { city: { contains: text, mode: "insensitive" } },
      { county: { contains: text, mode: "insensitive" } },
      { eircode: { contains: text, mode: "insensitive" } },
    );
  } else {
    delete where.OR; // avoid empty OR
  }

  // listing type filter (SALE/RENT)
  if (q.type && (q.type === "SALE" || q.type === "RENT")) {
    where.listingType = q.type as ListingType;
  }

  // status filter
  if (q.status && ["ACTIVE", "INACTIVE", "ARCHIVED"].includes(q.status)) {
    where.status = q.status as ListingStatus;
  } else {
    where.status = "ACTIVE";
  }

  // min/max price
  const minPrice = Number.isFinite(+q.minPrice) ? Number(q.minPrice) : undefined;
  const maxPrice = Number.isFinite(+q.maxPrice) ? Number(q.maxPrice) : undefined;

  if (minPrice != null || maxPrice != null) {
    where.price = {};
    if (minPrice != null) where.price.gte = minPrice;
    if (maxPrice != null) where.price.lte = maxPrice;
  }

  return where;
}

/**
 * GET /api/properties
 * Returns list for cards (now includes propertyType and sizeSqM)
 */
router.get("/properties", async (req: Request, res: Response) => {
  try {
    const where = buildWhere(req.query);

    const properties = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        price: true,
        listingType: true,
        status: true,

        bedrooms: true,
        bathrooms: true,

        addressLine1: true,
        addressLine2: true,
        city: true,
        county: true,
        eircode: true,

        propertyType: true,   // NEW
        sizeSqM: true,        // NEW

        images: {
          orderBy: { position: "asc" },
          take: 1,
          select: { url: true, width: true, height: true, format: true, position: true },
        },

        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || "Error" });
  }
});

/**
 * GET /api/properties/:slug
 * Full detail record (includes images)
 */
router.get("/properties/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const property = await prisma.property.findUnique({
      where: { slug },
      include: {
        images: { orderBy: { position: "asc" } },
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || "Error" });
  }
});

/**
 * POST /api/properties
 * Minimal create; accepts sizeSqM & propertyType
 */
router.post("/properties", async (req: Request, res: Response) => {
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

      sizeSqM,       // NEW
      propertyType,  // NEW

      images = [],
    } = req.body || {};

    if (!title || !price || !listingType || !slug) {
      return res.status(400).json({ ok: false, error: "Missing required fields: title, price, listingType, slug" });
    }

    const create = await prisma.property.create({
      data: {
        title,
        description: description ?? null,
        price: Number(price),
        listingType,
        status: status ?? "ACTIVE",

        bedrooms: bedrooms != null ? Number(bedrooms) : null,
        bathrooms: bathrooms != null ? Number(bathrooms) : null,

        addressLine1: addressLine1 ?? null,
        addressLine2: addressLine2 ?? null,
        city: city ?? null,
        county: county ?? null,
        eircode: eircode ?? null,

        sizeSqM: sizeSqM != null ? Number(sizeSqM) : null,
        propertyType: propertyType ?? "OTHER",

        slug,
        images: {
          create: (Array.isArray(images) ? images : []).map((img: any, i: number) => ({
            url: img.url,
            publicId: img.publicId ?? null,
            format: img.format ?? null,
            width: img.width != null ? Number(img.width) : null,
            height: img.height != null ? Number(img.height) : null,
            position: img.position != null ? Number(img.position) : i,
          })),
        },
      },
      include: { images: true },
    });

    res.json({ ok: true, property: create });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || "Error" });
  }
});

export default router;
