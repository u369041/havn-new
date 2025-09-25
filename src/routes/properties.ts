import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";

// ----- types (for clarity only) -----
interface ImageIn {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  order: number; // from frontend
}

const router = Router();

// ----- helpers -----
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

// Build a unique slug (retry if collision)
async function buildUniqueSlug(base: string): Promise<string> {
  let candidate = toSlug(base);
  if (!candidate) candidate = "listing";
  // check once
  const existing = await prisma.property.findUnique({ where: { slug: candidate } });
  if (!existing) return candidate;

  // retry with suffix
  for (let i = 0; i < 5; i++) {
    const cand = `${candidate}-${randId(6)}`;
    const ex = await prisma.property.findUnique({ where: { slug: cand } });
    if (!ex) return cand;
  }
  // final fallback
  return `${candidate}-${Date.now().toString(36)}`;
}

/**
 * POST /api/properties
 * Creates a persistent Property with up to 70 images.
 * Body shape matches your upload page.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as any;

    // required
    const title = (b.title ?? "").toString().trim();
    const description = (b.description ?? "").toString().trim();
    const price = Number(b.price ?? 0);

    if (!title || !description || !Number.isFinite(price) || price <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "title, description, and a positive price are required" });
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
        sort: Number(img?.order ?? i), // map order -> sort (schema uses sort)
      }))
      .filter((x) => x.url);

    if (images.length === 0) {
      return res.status(400).json({ ok: false, error: "at least one image is required" });
    }

    // slug
    const base = `${title} ${city || county || ""}`.trim();
    const slug = await buildUniqueSlug(base);

    // create property + images
    const created = await prisma.property.create({
      data: {
        slug,
        title,
        description,
        price,
        type: type as any,       // Prisma enum accepts string tag value
        status: status as any,   // Prisma enum accepts string tag value
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

    return res.json({ ok: true, property: created, imageCount: created.images.length });
  } catch (err: any) {
    console.error("POST /api/properties error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * GET /api/properties/:slug
 * Fetch a property by slug (with ordered images)
 */
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
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * GET /api/properties
 * List recent properties (with cover image first)
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const props = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      include: { images: { orderBy: { sort: "asc" } } },
      take: 60,
    });
    return res.json({ ok: true, count: props.length, properties: props });
  } catch (err: any) {
    console.error("GET /api/properties error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
