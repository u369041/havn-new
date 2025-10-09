// src/listings.ts
import { Router, Request, Response } from "express";
import { PrismaClient, ListingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/properties
 * Optional query params:
 *   q: string        (search title/city/county)
 *   type: SALE|RENT  (ListingType)
 *   status: ACTIVE|SOLD|RENTED|WITHDRAWN|DRAFT|ARCHIVED (defaults to ACTIVE only)
 *   minPrice, maxPrice: number
 */
router.get("/properties", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const type = req.query.type as string | undefined;
    const status = (req.query.status as string | undefined) ?? "ACTIVE";
    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;

    const where: any = {};

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (type) where.listingType = type;
    // default to ACTIVE unless a status is explicitly provided
    if (status) where.status = status as ListingStatus;

    if (typeof minPrice === "number" || typeof maxPrice === "number") {
      where.price = {};
      if (typeof minPrice === "number") where.price.gte = minPrice;
      if (typeof maxPrice === "number") where.price.lte = maxPrice;
    }

    const properties = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        images: { orderBy: { position: "asc" } },
      },
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message ?? "Unknown error" });
  }
});

/**
 * GET /api/properties/:slug
 * Returns a single property with all images.
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
    res.status(500).json({ ok: false, error: err.message ?? "Unknown error" });
  }
});

export default router;
