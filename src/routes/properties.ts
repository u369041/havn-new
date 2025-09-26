// src/routes/properties.ts
import { Router, Request, Response } from "express";
import {
  listProperties,
  getPropertyBySlug,
  createProperty,
  setImageOrder,
  setStatus
} from "../listings.js";

const router = Router();

function isAdmin(req: Request) {
  const hdr = req.header("x-admin-key") || "";
  const key = process.env.ADMIN_KEY || "";
  return key && hdr === key;
}

/** GET /api/properties */
router.get("/", async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const out = await listProperties({
      category: q.category,
      subtype: q.subtype,
      status: q.status,
      minPrice: typeof q.minPrice === "string" ? Number(q.minPrice) : undefined,
      maxPrice: typeof q.maxPrice === "string" ? Number(q.maxPrice) : undefined,
      beds: typeof q.beds === "string" ? Number(q.beds) : undefined,
      take: typeof q.take === "string" ? Number(q.take) : undefined,
      skip: typeof q.skip === "string" ? Number(q.skip) : undefined,
      sort: (q.sort as any) || "date_desc"
    });

    res.json({ ok: true, ...out });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/** GET /api/properties/:slug */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const prop = await getPropertyBySlug(req.params.slug);
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, property: prop });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/** POST /api/properties */
router.post("/", async (req: Request, res: Response) => {
  try {
    const prop = await createProperty(req.body);
    res.status(201).json({ ok: true, property: prop });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

/** PUT /api/properties/:id/images/order */
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

/** PATCH /api/properties/:id/status (admin only) */
router.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const updated = await setStatus(req.params.id, String(req.body?.status || ""));
    res.json({ ok: true, property: updated });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || "failed" });
  }
});

export default router;
