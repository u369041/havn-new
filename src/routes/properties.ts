import { Router, Request, Response } from "express";
import { PrismaClient, ListingStatus, ListingType } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/properties
 * List properties with optional filters.
 * If none found, returns ok:true with empty array instead of an error.
 *
 * Query params (all optional):
 *   q            - free text search in title/description/city/county
 *   type         - SALE | RENT
 *   status       - ACTIVE | ARCHIVED | DRAFT
 *   minPrice     - number
 *   maxPrice     - number
 *   city         - string
 *   county       - string
 *   eircode      - string
 *   limit        - number (default 50, max 100)
 *   offset       - number (default 0)
 */
router.get("/properties", async (req: Request, res: Response) => {
  try {
    const {
      q,
      type,
      status,
      minPrice,
      maxPrice,
      city,
      county,
      eircode,
      limit = "50",
      offset = "0",
    } = req.query as Record<string, string>;

    const take = Math.min(Math.max(parseInt(limit || "50", 10) || 50, 1), 100);
    const skip = Math.max(parseInt(offset || "0", 10) || 0, 0);

    const where: any = {};

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
      ];
    }
    if (type && (type === "SALE" || type === "RENT")) {
      where.listingType = type as ListingType;
    }
    if (status && (status === "ACTIVE" || status === "ARCHIVED" || status === "DRAFT")) {
      where.status = status as ListingStatus;
    }
    if (minPrice) {
      where.price = { ...(where.price || {}), gte: Number(minPrice) };
    }
    if (maxPrice) {
      where.price = { ...(where.price || {}), lte: Number(maxPrice) };
    }
    if (city) where.city = { contains: city, mode: "insensitive" };
    if (county) where.county = { contains: county, mode: "insensitive" };
    if (eircode) where.eircode = { equals: eircode, mode: "insensitive" };

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          images: {
            orderBy: { position: "asc" },
          },
        },
      }),
    ]);

    // ✅ Return an empty list instead of error if nothing found
    return res.json({
      ok: true,
      count,
      properties,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

/**
 * GET /api/properties/:slug
 * Fetch a single property by slug. 404-style ok:false when missing.
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

    return res.json({ ok: true, property });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

export default router;
