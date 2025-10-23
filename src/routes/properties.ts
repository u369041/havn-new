import { Router } from "express";
import { prisma } from "../prisma.js";

export const properties = Router();

// GET /api/properties
properties.get("/", async (req, res) => {
  const raw = Number(req.query.limit ?? 50);
  const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;

  try {
    const rows = await prisma.property.findMany({
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
        photos: true,
        overview: true,
        features: true,
        createdAt: true
      }
    });
    res.json({ ok: true, count: rows.length, properties: rows });
  } catch (err) {
    console.error("❌ GET /api/properties failed:", err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/properties/:slug
properties.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug }
    });
    if (!item) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, property: item });
  } catch (err) {
    console.error("❌ GET /api/properties/:slug failed:", err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});
