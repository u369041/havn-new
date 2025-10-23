import express from "express";
import { prisma } from "../prisma.js";

export const listings = express.Router();

/**
 * GET /api/listings
 * Same contract as /properties
 */
listings.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const q = String(req.query.q ?? "").trim();

    const where = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        }
      : {};

    const [count, rows] = await Promise.all([
      prisma.property.count({ where }), // if you have a dedicated Listing model, swap to it
      prisma.property.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          listingType: true,
        },
      }),
    ]);

    res.json({
      ok: true,
      count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
      listings: rows,
    });
  } catch (err) {
    console.error("GET /listings error", err);
    res.status(500).json({ ok: false, error: "list-failed" });
  }
});

/**
 * GET /api/listings/:slug
 */
listings.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        listingType: true,
        images: { select: { id: true, url: true, alt: true }, orderBy: { id: "asc" } },
      } as any,
    });

    if (!item) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, listing: item });
  } catch (err) {
    console.error("GET /listings/:slug error", err);
    res.status(500).json({ ok: false, error: "detail-failed" });
  }
});
