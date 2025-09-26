// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { listProperties, getPropertyBySlug, createProperty, setImageOrder } from "../listings";

const router = Router();

/**
 * GET /api/properties
 * Query: type, status, minPrice, maxPrice, beds, take, skip, sort
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      type,
      status,
      minPrice,
      maxPrice,
      beds,
      take,
      skip,
      sort,
    } = req.query as Record<string, string | undefined>;

    const out = await listProperties({
      type: type || undefined,
      status: (status as any) || undefined,
      minPrice: typeof minPrice === "string" ? Number(minPrice) : undefined,
      maxPrice: typeof maxPrice === "string" ? Number(maxPrice) : undefined,
      beds: typeof beds === "string" ? Number(beds) : undefined,
      take: typeof take === "string" ? Number(take) : undefined,
      skip: typeof skip === "string" ? Number(skip) : undefined,
      sort: (sort as any) || undefined,
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
 * Body accepts legacy keys; mapped internally.
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
