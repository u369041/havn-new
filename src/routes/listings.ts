import express from "express";
import { prisma } from "../prisma.js";

const router = express.Router();

/**
 * GET /api/listings
 * Lightweight list of properties (good for cards/grids).
 * Query params:
 *   - skip?: number (default 0)
 *   - take?: number (default 50, max 100)
 */
router.get("/listings", async (req, res) => {
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
          type: true,
          photos: true, // array of strings
          createdAt: true,
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
      listings: items,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "listings failed" });
  }
});

export default router;
