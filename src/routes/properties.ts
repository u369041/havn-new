import { Router, Request, Response } from "express";
import prisma from "../prisma.js";

const router = Router();

router.get("/__ping", async (_req: Request, res: Response) => {
  try {
    const ping = await prisma.$queryRawUnsafe<{ now: Date }[]>(`SELECT NOW() AS now`);
    res.json({ ok: true, ping });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: "db_ping_failed",
      message: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null
    });
  }
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const props = await prisma.property.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ ok: true, count: props.length, properties: props });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: "internal_error",
      message: err?.message || String(err),
      code: err?.code || null,
      meta: err?.meta || null
    });
  }
});

router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const p = await prisma.property.findUnique({ where: { slug: req.params.slug } });
    if (!p) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, property: p });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "internal_error", message: err?.message || String(err) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const d = req.body || {};
    if (!d.slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const existing = await prisma.property.findUnique({ where: { slug: d.slug } });
    if (existing) return res.json({ ok: true, reused: true, property: existing });

    const created = await prisma.property.create({
      data: {
        slug: d.slug,
        title: d.title || "Untitled",
        address1: d.address1 || "",
        address2: d.address2 || "",
        city: d.city || "",
        county: d.county || "",
        eircode: d.eircode || "",
        price: d.price ?? null,
        status: d.status ?? null,
        propertyType: d.propertyType ?? null,
        ber: d.ber ?? null,
        bedrooms: d.bedrooms ?? null,
        bathrooms: d.bathrooms ?? null,
        size: d.size ?? null,
        sizeUnits: d.sizeUnits ?? null,
        features: Array.isArray(d.features) ? d.features : [],
        description: d.description || "",
        photos: Array.isArray(d.photos) ? d.photos : [],
        createdAt: new Date()
      }
    });

    res.json({ ok: true, property: created });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "internal_error", message: err?.message || String(err) });
  }
});

export default router;
