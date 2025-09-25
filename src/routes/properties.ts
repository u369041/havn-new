import { Router, type Request, type Response } from "express";

const router = Router();

// helpers
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

/**
 * POST /api/properties
 * Mock create: validates payload shape, caps images to 70,
 * returns a slug and echoes back a normalized property.
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
  const images = imagesRaw
    .slice(0, MAX)
    .map((img: any, i: number) => ({
      url: String(img?.url || ""),
      width: Number(img?.width || 0) || undefined,
      height: Number(img?.height || 0) || undefined,
      alt: (img?.alt ?? title).toString(),
      order: Number(img?.order ?? i),
    }))
    .filter((x: any) => x.url);

  if (images.length === 0) {
    return res.status(400).json({ ok: false, error: "at least one image is required" });
  }

  const base = `${title} ${city || county}`;
  const slug = `${toSlug(base)}-${randId(6)}`;

  // Mock response (no DB yet)
  const property = {
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

  return res.json({ ok: true, property, imageCount: images.length });
});

export default router;
