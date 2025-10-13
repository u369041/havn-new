# 0) Clean up any broken files
Remove-Item -Force src\routes\properties.ts, src\routes\listings.ts -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path src\routes | Out-Null

# 1) Recreate src\routes\properties.ts (clean ASCII)
$props = @'
import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

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

router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const p = await prisma.property.findUnique({ where: { slug: req.params.slug } });
    if (!p) return res.status(404).json({ ok: false, error: "not-found" });
    res.json(p);
  } catch (err) {
    console.error("[properties] get error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    const missing: string[] = [];
    if (!body.slug) missing.push("slug");
    if (!body.title) missing.push("title");
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
'@
Set-Content -Path src\routes\properties.ts -Value $props -Encoding UTF8

# 2) Recreate src\routes\listings.ts (clean ASCII)
$listings = @'
import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, listingType, q } = req.query as Record<string, string | undefined>;
    const take = Math.min(Math.max(parseInt((req.query.limit as string) ?? "50", 10) || 50, 1), 200);

    const where: any = {};
    if (status) where.status = String(status);
    if (listingType) where.listingType = String(listingType);
    if (q) {
      const term = String(q);
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { address: { contains: term, mode: "insensitive" } },
        { eircode: { contains: term.replace(/\s+/g, ""), mode: "insensitive" } }
      ];
    }

    const rows = await prisma.property.findMany({
      where,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, title: true, status: true, listingType: true,
        price: true, address: true, eircode: true, images: true, createdAt: true
      }
    });

    res.json({ ok: true, count: rows.length, listings: rows });
  } catch (err) {
    console.error("[listings] list error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const p = await prisma.property.findUnique({ where: { slug: req.params.slug } });
    if (!p) return res.status(404).json({ ok: false, error: "not-found" });
    res.json({ ok: true, listing: p });
  } catch (err) {
    console.error("[listings] get error:", err);
    res.status(500).json({ ok: false, error: "server-error" });
  }
});

export default router;
'@
Set-Content -Path src\routes\listings.ts -Value $listings -Encoding UTF8
