import express from "express";
import { prisma } from "../prisma.js";

export const properties = express.Router();

/**
 * GET /api/properties
 * Query:
 *   - page?: number (1+)
 *   - pageSize?: number (1..100, default 20)
 *   - q?: string (search in title or slug)
 */
properties.get("/", async (req, res) => {
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
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          listingType: true, // keep only fields that exist in your schema
        },
      }),
    ]);

    res.json({
      ok: true,
      count,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(count / pageSize)),
      properties: rows,
    });
  } catch (err) {
    console.error("GET /properties error", err);
    res.status(500).json({ ok: false, error: "list-failed" });
  }
});

/**
 * GET /api/properties/:slug
 */
properties.get("/:slug", async (req, res) => {
  try {
    const item = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        listingType: true,
        // add/adjust selects to match your schema
        images: {
          select: { id: true, url: true, alt: true },
          orderBy: { id: "asc" },
        },
      } as any,
    });

    if (!item) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, property: item });
  } catch (err) {
    console.error("GET /properties/:slug error", err);
    res.status(500).json({ ok: false, error: "detail-failed" });
  }
});
