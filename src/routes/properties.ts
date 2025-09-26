// src/routes/properties.ts
import { Router, Request, Response } from "express";
import {
  listProperties,
  getPropertyBySlug,
  createProperty,
  setImageOrder,
} from "../listings.js";

const router = Router();

/**
 * GET /api/properties
 * Query: category, subtype, status, minPrice, maxPrice, beds, take, skip, sort
 * (also supports legacy: type)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const out = await listProperties({
      category: q.category,
      subtype: q.subtype,
      type: q.type, // legacy exact match support
      status: q.status as any,
      minPrice: typeof q.minPrice === "string" ? Number(q.minPrice) : undefined,
      maxPrice: typeof q.maxPrice === "string" ? Number(q.maxPrice) : undefined,
      beds: typeof q.beds === "string" ? Number(q.beds) : undefined,
      take: typeof q.take === "string" ? Number(q.take) : undefined,
      skip: typeof q.skip === "string" ? Number(q.skip) : undefined,
      sort: q.sort as any,
    });

    res.json({ ok: true, ...out });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/**
 * GET /api/properties/:slug
 */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const prop = await getPropertyBySlug(req.params.slug);
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, property: prop });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/**
 * POST /api/properties
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const prop = await createProperty(req.body);
    res.status(201).json({ ok: true, property: prop });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/**
 * PUT /api/properties/:id/images/order
 * Body: { imageIds: string[] }
 */
router.put("/:id/images/order", async (req: Request, res: Response) => {
  try {
    const propertyId = req.params.id;
    const imageIds: string[] = Array.isArray(req.body?.imageIds)
      ? req.body.imageIds
      : [];

    const images = await setImageOrder(propertyId, imageIds);
    res.json({ ok: true, images });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

export default router;
