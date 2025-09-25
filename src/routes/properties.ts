import { Router, type Request, type Response } from "express";

const router = Router();

// ----- types -----
interface Image {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  order: number;
}
interface Property {
  slug: string;
  title: string;
  description: string;
  price: number;
  type?: string;
  status: string;
  address?: string;
  city?: string;
  county?: string;
  eircode?: string;
  beds?: number;
  baths?: number;
  areaSqm?: number;
  images: Image[];
  createdAt: string; // ISO
}

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

// ----- in-memory store (temporary, resets on restart) -----
const store = new Map<string, Property>();

/**
 * POST /api/properties
 * Mock create: validates payload, caps images to 70, stores in memory, returns the property.
 */
router.post("/", (req: Request, res: Response) => {
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

  // optional text
  const city = (b.city ?? "").toString().trim();
  const county = (b.county ?? "").toString().trim();
  const address = (b.address ?? "").toString().trim();
  const eircode = (b.eircode ?? "").toString().trim();
  const type = ((b.type ?? "") as string).toString().trim().toUpperCase() || undefined;
  const status = ((b.status ?? "ACTIVE") as string).toString().trim().toUpperCase();

  // numbers
  const beds = b.beds != null && b.beds !== "" ? Number(b.beds) : undefined;
  const baths = b.baths != null && b.baths !== "" ? Number(b.baths) : undefined;
  const areaSqm = b.areaSqm != null && b.areaSqm !== "" ? Number(b.areaSqm) : undefined;

  // images (cap at 70)
  const MAX = 70;
  const imagesRaw: any[] = Array.isArray(b.images) ? (b.images as any[]) : [];
  const images: Image[] = imagesRaw
    .slice(0, MAX)
    .map((img: any, i: number) => ({
      url: String(img?.url || ""),
      width: Number(img?.width || 0) || undefined,
      height: Number(img?.height || 0) || undefined,
      alt: (img?.alt ?? title).toString(),
      order: Number(img?.order ?? i),
    }))
    .filter((x: Image) => x.url);

  if (images.length === 0) {
    return res.status(400).json({ ok: false, error: "at least one image is required" });
  }

  const base = `${title} ${city || county}`;
  const slug = `${toSlug(base)}-${randId(6)}`;

  const property: Property = {
    slug,
    title,
    description,
    price,
    type,
    status,
    address,
    city,
    county,
    eircode,
    beds,
    baths,
    areaSqm,
    images,
    createdAt: new Date().toISOString(),
  };

  // store in-memory
  store.set(slug, property);

  return res.json({ ok: true, property, imageCount: images.length });
});

/**
 * GET /api/properties/:slug
 * Retrieve a stored property by slug.
 */
router.get("/:slug", (req: Request, res: Response) => {
  const slug = String(req.params.slug || "");
  const property = store.get(slug);
  if (!property) return res.status(404).json({ ok: false, error: "not found" });
  return res.json({ ok: true, property });
});

/**
 * GET /api/properties
 * List recent properties (in-memory).
 */
router.get("/", (_req: Request, res: Response) => {
  const all = Array.from(store.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  return res.json({ ok: true, count: all.length, properties: all });
});

export default router;
