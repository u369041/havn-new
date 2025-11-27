// src/routes/listings.ts
import { Router, Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

const router = Router();

/**
 * GET /api/properties
 * Query params:
 * - q: string (free text search over a few columns)
 * - city / county / status / listingType: optional filters
 * - minPrice / maxPrice: numbers
 * - take / skip: pagination
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const city = (req.query.city as string | undefined)?.trim();
    const county = (req.query.county as string | undefined)?.trim();
    const status = (req.query.status as string | undefined)?.trim();
    const listingType = (req.query.listingType as string | undefined)?.trim();

    const minPrice = Number.isFinite(Number(req.query.minPrice))
      ? Number(req.query.minPrice)
      : undefined;
    const maxPrice = Number.isFinite(Number(req.query.maxPrice))
      ? Number(req.query.maxPrice)
      : undefined;

    const take = Math.min(
      Math.max(parseInt((req.query.take as string) ?? "50", 10), 1),
      200
    );
    const skip = Math.max(parseInt((req.query.skip as string) ?? "0", 10), 0);

    const where: Prisma.PropertyWhereInput = {
      AND: [
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" as const } },
                { city: { contains: q, mode: "insensitive" as const } },
                { county: { contains: q, mode: "insensitive" as const } },
                { eircode: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {},
        city ? { city: { equals: city, mode: "insensitive" as const } } : {},
        county
          ? { county: { equals: county, mode: "insensitive" as const } }
          : {},
        status ? { status: { equals: status } } : {},
        listingType ? { listingType: { equals: listingType } } : {},
        minPrice !== undefined ? { price: { gte: minPrice } } : {},
        maxPrice !== undefined ? { price: { lte: maxPrice } } : {},
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.property.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          listingType: true,
          price: true,
          city: true,
          county: true,
          eircode: true,
          photos: true,
          beds: true,
          baths: true,
          ber: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.property.count({ where }),
    ]);

    res.json({ ok: true, total, rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

export default router;
