import express from "express";
import { prisma } from "../prisma.js";

export const properties = express.Router();

/** GET /api/properties */
properties.get("/", async (_req, res) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: { id: "desc" },
      // Keep ONLY fields that exist in your schema
      select: { id: true, slug: true, title: true },
    });
    res.json({ ok: true, count: items.length, properties: items });
  } catch (err) {
    console.error("properties.list error:", err);
    res.status(500).json({ ok: false, error: "list-failed" });
  }
});

/** GET /api/properties/:slug */
properties.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, slug: true, title: true },
    });
    if (!item) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, property: item });
  } catch (err) {
    console.error("properties.get error:", err);
    res.status(500).json({ ok: false, error: "get-failed" });
  }
});
