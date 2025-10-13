import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/** GET /api/properties */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, title: true, status: true, listingType: true,
        price: true, pricePeriod: true, address: true, eircode: true,
        city: true, county: true, type: true, ber: true, beds: true, baths: true,
        area: true, images: true, createdAt: true, updatedAt: true
      }
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error("[properties] list error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

/** GET /api/properties/:slug */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const p = await prisma.property.findUnique({ where: { slug } });
    if (!p) return res.status(404).json({ ok: false, error: "not-found" });
    res.json(p);
  } catch (err) {
    console.error("[properties] get error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

/** POST /api/properties */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    const missing: string[] = [];
    if (!body.slug)    missing.push("slug");
    if (!body.title)   missing.push("title");
    if (body.price == null || isNaN(Number(body.price))) missing.push("price");
    if (!body.address) missing.push("address");
    if (!body.eircode) missing.push("eircode");
    if (missing.length) {
      return res.status(400).json({ ok: false, error: "missing-fields", missing });
    }

    const data: any = {
      slug: String(body.slug),
      title: String(body.title),
      status: body.listingType === "rent" ? "To Rent" : (body.status || "For Sale"),
      listingType: body.listingType || "sale",
      price: Number(body.price),
      pricePeriod: body.pricePeriod ?? null,
      address: String(body.address),
      eircode: String(body.eircode).toUpperCase().replace(/\s+/g, ""),
      city: body.city ?? null,
      county: body.county ?? null,
      type: body.type ?? null,
      ber: body.ber ?? null,
      beds: body.beds != null ? Number(body.beds) : null,
      baths: body.baths != null ? Number(body.baths) : null,
      area: body.area != null ? Number(body.area) : null,
      description: body.description ?? "",
      images: Array.isArray(body.images) ? body.images.map(String) : [],
      videoUrl: body.videoUrl ?? null,
      floorplans: Array.isArray(body.floorplans) ? body.floorplans.map(String) : []
    };

    const created = await prisma.property.create({ data });
    return res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    if ((err as any)?.code === "P2002") {
      return res.status(409).json({ ok: false, error: "duplicate-slug" });
    }
    console.error("[properties] create error:", err);
    return res.status(500).json({ ok: false, error: "server-error" });
  }
});

export default router;
