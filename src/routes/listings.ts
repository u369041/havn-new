import { Router } from "express";
import { prisma } from "../prisma.js";

export const listings = Router();

// GET /api/listings
listings.get("/", async (_req, res) => {
  try {
    const rows = await prisma.property.findMany({
      take: 50,
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
        photos: true
      }
    });
    res.json({ ok: true, count: rows.length, listings: rows });
  } catch (err) {
    console.error("❌ GET /api/listings failed:", err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/listings/:slug
listings.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug }
    });
    if (!item) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, listing: item });
  } catch (err) {
    console.error("❌ GET /api/listings/:slug failed:", err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});
