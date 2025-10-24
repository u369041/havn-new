import express from "express";
import { prisma } from "../prisma.js";

const router = express.Router();

/**
 * GET /api/properties
 * Full property records (paginated).
 * Query params:
 *   - skip?: number (default 0)
 *   - take?: number (default 50, max 100)
 */
router.get("/properties", async (req, res) => {
  try {
    const skip = Number(req.query.skip ?? 0);
    const take = Math.min(100, Math.max(0, Number(req.query.take ?? 50)));

    const [items, total] = await Promise.all([
      prisma.property.findMany({
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          price: true,
          beds: true,
          baths: true,
          ber: true,
          eircode: true,
          type: true,
          photos: true,     // string[]
          overview: true,   // string | null
          features: true,   // string[]
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.property.count(),
    ]);

    res.json({
      ok: true,
      count: items.length,
      total,
      skip,
      take,
      properties: items,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "properties failed" });
  }
});

/**
 * GET /api/properties/:slug
 * Single property by slug.
 */
router.get("/properties/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const property = await prisma.property.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        price: true,
        beds: true,
        baths: true,
        ber: true,
        eircode: true,
        type: true,
        photos: true,
        overview: true,
        features: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "property failed" });
  }
});

export default router;
