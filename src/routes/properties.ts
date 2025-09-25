// src/routes/properties.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";

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

    // ping sitemap (fire & forget)
    if (SITEMAP_PING_URL) void fetch(SITEMAP_PING_URL).catch(() => {});

    return res.json({ ok: true, property: created, imageCount: created.images.length });
  } catch (err: any) {
    console.error("POST /api/properties error", err);
    return res.status(500).json({ ok: false, error: err?.message || "internal_error", code: err?.code });
  }
});

/** GET /api/properties/:slug - fetch by slug */
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
      orderBy: { createdAt: "desc" },
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
