// src/routes/properties.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/admin.js";

// --- config ---
const SITEMAP_PING_URL = process.env.SITEMAP_PING_URL || "";

// --- types from frontend payload ---
interface ImageIn {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  order: number;
}

const router = Router();

// --- helpers ---
function toSlug(input: string): string {
  return (
    (input || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "") || "listing"
  );
}
function randId(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

const ALLOWED_TYPES = new Set(["HOUSE","APARTMENT","DUPLEX","TOWNHOUSE","LAND","OTHER"]);
const ALLOWED_STATUS = new Set(["ACTIVE","SOLD","LET","DRAFT"]);
const ALLOWED_CATEGORY = new Set(["BUY","RENT","SHARE"]);

// Fire & forget sitemap ping
function pingSitemap() {
  if (!SITEMAP_PING_URL) return;
  try { void fetch(SITEMAP_PING_URL).catch(() => {}); } catch {}
}

// Build a unique slug (retry if collision)
async function buildUniqueSlug(base: string): Promise<string> {
  let candidate = toSlug(base);
  if (!candidate) candidate = "listing";
  const existing = await prisma.property.findUnique({ where: { slug: candidate } });
  if (!existing) return candidate;

  for (let i = 0; i < 5; i++) {
    const cand = `${candidate}-${randId(6)}`;
    const ex = await prisma.property.findUnique({ where: { slug: cand } });
    if (!ex) return cand;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}

/** POST /api/properties
 * Creates a property with up to 70 images.
 * Accepts: title, description, price, [type,status,category,address,city,county,eircode,beds,baths,areaSqm,images[]]
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as any;

    // required
    const title = (b.title ?? "").toString().trim();
    const description = (b.description ?? "").toString().trim();
    const price = Number(b.price ?? 0);
    if (!title || !description || !Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ ok: false, error: "title, description, and a positive price are required" });
    }

    // optional strings/enums
    const city = (b.city ?? "").toString().trim() || undefined;
    const county = (b.county ?? "").toString().trim() || undefined;
    const address = (b.address ?? "").toString().trim() || undefined;
    const eircode = (b.eircode ?? "").toString().trim() || undefined;

    let type = (b.type ?? "").toString().trim().toUpperCase();
    if (!ALLOWED_TYPES.has(type)) type = undefined as unknown as string;

    let status = (b.status ?? "ACTIVE").toString().trim().toUpperCase();
    if (!ALLOWED_STATUS.has(status)) status = "ACTIVE";

    let category = (b.category ?? "BUY").toString().trim().toUpperCase();
    if (!ALLOWED_CATEGORY.has(category)) category = "BUY";

    // numbers
    const beds = b.beds != null && b.beds !== "" ? Number(b.beds) : undefined;
    const baths = b.baths != null && b.baths !== "" ? Number(b.baths) : undefined;
    const areaSqm = b.areaSqm != null && b.areaSqm !== "" ? Number(b.areaSqm) : undefined;

    // images (cap at 70)
    const MAX = 70;
    const imagesRaw: ImageIn[] = Array.isArray(b.images) ? (b.images as ImageIn[]) : [];
    const images = imagesRaw
      .slice(0, MAX)
      .map((img, i) => ({
        url: String(img?.url || ""),
        width: img?.width != null ? Number(img.width) : undefined,
        height: img?.height != null ? Number(img.height) : undefined,
        alt: (img?.alt ?? title).toString(),
        sort: Number(img?.order ?? i), // schema uses "sort"
      }))
      .filter((x) => x.url);

    if (images.length === 0) {
      return res.status(400).json({ ok: false, error: "at least one image is required" });
    }

    // slug
    const base = `${title} ${city || county || ""}`.trim();
    const slug = await buildUniqueSlug(base);

    // create
    const created = await prisma.property.create({
      data: {
        slug,
        title,
        description,
        price,
        type: type as any,
        status: status as any,
        category: category as any, // <-- NEW
        address,
        city,
        county,
        eircode,
        beds,
        baths,
        areaSqm,
        images: {
          create: images.map((img) => ({
            url: img.url,
            width: img.width,
            height: img.height,
            alt: img.alt,
            sort: img.sort,
          })),
        },
      },
      include: { images: { orderBy: { sort: "asc" } } },
    });

    pingSitemap();
    return res.json({ ok: true, property: created, imageCount: created.images.length });
  } catch (err: any) {
    console.error("POST /api/properties error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** PUT /api/properties/:slug  (ADMIN)
 * Update core fields (no images here).
 * Body may include any of:
 * { title, description, price, type, status, category, address, city, county, eircode, beds, baths, areaSqm }
 */
router.put("/:slug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "");
    const prop = await prisma.property.findUnique({ where: { slug } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });

    const b = (req.body ?? {}) as any;
    const data: any = {};

    if (b.title != null) {
      const t = String(b.title).trim();
      if (!t) return res.status(400).json({ ok: false, error: "title cannot be empty" });
      data.title = t;
    }
    if (b.description != null) data.description = String(b.description).trim();
    if (b.price != null) {
      const p = Number(b.price);
      if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ ok: false, error: "price must be positive" });
      data.price = p;
    }
    if (b.type != null) {
      const t = String(b.type).trim().toUpperCase();
      if (t && !ALLOWED_TYPES.has(t)) return res.status(400).json({ ok: false, error: "invalid type" });
      data.type = t || null;
    }
    if (b.status != null) {
      const s = String(b.status).trim().toUpperCase();
      if (!ALLOWED_STATUS.has(s)) return res.status(400).json({ ok: false, error: "invalid status" });
      data.status = s;
    }
    if (b.category != null) {
      const c = String(b.category).trim().toUpperCase();
      if (!ALLOWED_CATEGORY.has(c)) return res.status(400).json({ ok: false, error: "invalid category" });
      data.category = c;
    }
    if (b.address != null) data.address = String(b.address).trim() || null;
    if (b.city != null) data.city = String(b.city).trim() || null;
    if (b.county != null) data.county = String(b.county).trim() || null;
    if (b.eircode != null) data.eircode = String(b.eircode).trim() || null;
    if (b.beds != null && b.beds !== "") data.beds = Number(b.beds);
    if (b.baths != null && b.baths !== "") data.baths = Number(b.baths);
    if (b.areaSqm != null && b.areaSqm !== "") data.areaSqm = Number(b.areaSqm);

    const updated = await prisma.property.update({
      where: { slug },
      data,
      include: { images: { orderBy: { sort: "asc" } } },
    });

    pingSitemap();
    return res.json({ ok: true, property: updated });
  } catch (err: any) {
    console.error("PUT /api/properties/:slug error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** PATCH /api/properties/:slug/images  (ADMIN)
 * Reorder/add/remove images.
 * Body supports:
 * {
 *   reorder?: Array<{ id?: number, url?: string, sort: number }>,
 *   removeIds?: number[],
 *   add?: Array<{ url: string, width?: number, height?: number, alt?: string, sort?: number }>
 * }
 */
router.patch("/:slug/images", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "");
    const prop = await prisma.property.findUnique({ where: { slug } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });

    const b = (req.body ?? {}) as any;

    // Remove first (optional)
    if (Array.isArray(b.removeIds) && b.removeIds.length) {
      await prisma.propertyImage.deleteMany({
        where: { id: { in: b.removeIds.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) }, propertyId: prop.id },
      });
    }

    // Add new images (optional)
    if (Array.isArray(b.add) && b.add.length) {
      const toCreate = b.add
        .map((x: any, i: number) => ({
          url: String(x.url || ""),
          width: x.width != null ? Number(x.width) : undefined,
          height: x.height != null ? Number(x.height) : undefined,
          alt: (x.alt ?? prop.title ?? "").toString(),
          sort: x.sort != null ? Number(x.sort) : i + 1000, // put after existing unless sort given
        }))
        .filter((x: any) => x.url);
      if (toCreate.length) {
        await prisma.propertyImage.createMany({
          data: toCreate.map((img: any) => ({ ...img, propertyId: prop.id })),
        });
      }
    }

    // Reorder (optional)
    if (Array.isArray(b.reorder) && b.reorder.length) {
      for (const item of b.reorder) {
        const sort = Number(item.sort);
        if (!Number.isFinite(sort)) continue;

        if (item.id != null) {
          const id = Number(item.id);
          if (!Number.isFinite(id)) continue;
          await prisma.propertyImage.updateMany({
            where: { id, propertyId: prop.id },
            data: { sort },
          });
        } else if (item.url) {
          await prisma.propertyImage.updateMany({
            where: { url: String(item.url), propertyId: prop.id },
            data: { sort },
          });
        }
      }
    }

    const refreshed = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });

    return res.json({ ok: true, property: refreshed });
  } catch (err: any) {
    console.error("PATCH /api/properties/:slug/images error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** DELETE /api/properties/:slug  (ADMIN)
 * Deletes images then the property.
 */
router.delete("/:slug", requireAdmin, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "");
    const prop = await prisma.property.findUnique({ where: { slug } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });

    // Delete child images first (defensive even if FK has ON DELETE CASCADE)
    await prisma.propertyImage.deleteMany({ where: { propertyId: prop.id } });
    await prisma.property.delete({ where: { id: prop.id } });

    pingSitemap();
    return res.json({ ok: true, deleted: true, slug });
  } catch (err: any) {
    console.error("DELETE /api/properties/:slug error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** GET /api/properties/:slug - public fetch by slug */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "");
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    if (!property) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, property });
  } catch (err: any) {
    console.error("GET /api/properties/:slug error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** GET /api/properties
 * Filters:
 *   ?category=BUY|RENT|SHARE
 *   ?limit=1..100   (default 60)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    let where: any = {};
    const qcat = String(req.query.category ?? "").trim().toUpperCase();
    if (qcat && ALLOWED_CATEGORY.has(qcat)) where.category = qcat as any;

    let limit = Number(req.query.limit ?? 60);
    if (!Number.isFinite(limit) || limit <= 0) limit = 60;
    if (limit > 100) limit = 100;

    const props = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "asc" }, // tip: change to "desc" if you prefer newest first
      include: { images: { orderBy: { sort: "asc" } } },
      take: limit,
    });
    return res.json({ ok: true, count: props.length, properties: props });
  } catch (err: any) {
    console.error("GET /api/properties error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

export default router;
