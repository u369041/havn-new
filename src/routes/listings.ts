import express from "express";
import { prisma } from "../prisma.js";

export const listings = express.Router();

/** GET /api/listings  (list properties as "listings") */
listings.get("/", async (_req, res) => {
  try {
    const rows = await prisma.property.findMany({
      orderBy: { id: "desc" },
      select: { id: true, slug: true, title: true },
    });
    res.json({ ok: true, count: rows.length, listings: rows });
  } catch (err) {
    console.error("listings.list error:", err);
    res.status(500).json({ ok: false, error: "list-failed" });
  }
});

/** GET /api/listings/:slug */
listings.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, slug: true, title: true },
    });
    if (!item) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, listing: item });
  } catch (err) {
    console.error("listings.get error:", err);
    res.status(500).json({ ok: false, error: "get-failed" });
  }
});
