// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";
import slugify from "slugify";

const prisma = new PrismaClient();
const router = Router();

/** Helper: ft² → m² (rounded to 2 dp) */
function ft2ToM2(ft2: number): number {
  return Math.round(ft2 * 0.092903 * 100) / 100;
}

/** Helper to build a unique slug */
async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base, { lower: true, strict: true });
  if (!slug || slug === "-") slug = `listing-${Date.now()}`;

  let suffix = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exist = await prisma.property.findUnique({ where: { slug } });
    if (!exist) return slug;
    suffix += 1;
    slug = `${slug}-${suffix}`;
  }
}

/** List properties with simple filters */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      q,
      type,
      status,
      minPrice,
      maxPrice,
      city,
      county,
      page = "1",
      pageSize = "24",
    } = req.query as Record<string, string>;

    const where: any = {};

    if (q) {
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (type && ["SALE", "RENT"].includes(type)) where.listingType = type as ListingType;
    if (status && status === "ACTIVE") where.status = status as ListingStatus;

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }

    if (city) where.city = { contains: city, mode: "insensitive" };
    if (county) where.county = { contains: county, mode: "insensitive" };

    const take = Math.min(Math.max(parseInt(pageSize, 10) || 24, 1), 100);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        include: { images: { orderBy: { position: "asc" } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "Unexpected error" });
  }
});

/** Get one property by slug */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const property = await prisma.property.findUnique({
      where: { slug: req.params.slug },
      include: { images: { orderBy: { position: "asc" } } },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "Unexpected error" });
  }
});

/** Create property */
router.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};

    // Accept sizeSqM directly, or compute from areaSqFt if provided
    let sizeSqM: number | null = null;
    if (typeof b.sizeSqM === "number") sizeSqM = b.sizeSqM;
    else if (typeof b.areaSqFt === "number") sizeSqM = ft2ToM2(b.areaSqFt);

    // Basic requireds
    if (!b.title) return res.status(400).json({ ok: false, error: "title required" });
    if (!b.price && b.price !== 0) return res.status(400).json({ ok: false, error: "price required" });

    const slug = await uniqueSlug(
      b.slug ||
        b.title ||
        `${b.city ?? ""}-${b.county ?? ""}-${Math.floor(Math.random() * 1e6)}`
    );

    const listingType: ListingType = (b.listingType === "RENT" ? "RENT" : "SALE");
    const status: ListingStatus = "ACTIVE"; // we normalized statuses in DB

    const imagesInput: Array<{
      url: string;
      publicId?: string | null;
      width?: number | null;
      height?: number | null;
      format?: string | null;
      position?: number | null;
    }> = Array.isArray(b.images) ? b.images : [];

    const property = await prisma.property.create({
      data: {
        title: b.title,
        description: b.description ?? null,
        price: Number(b.price),
        listingType,
        status,
        addressLine1: b.addressLine1 ?? null,
        addressLine2: b.addressLine2 ?? null,
        city: b.city ?? null,
        county: b.county ?? null,
        eircode: b.eircode ?? null,
        latitude: typeof b.latitude === "number" ? b.latitude : null,
        longitude: typeof b.longitude === "number" ? b.longitude : null,
        bedrooms: typeof b.bedrooms === "number" ? b.bedrooms : null,
        bathrooms: typeof b.bathrooms === "number" ? b.bathrooms : null,
        sizeSqM, // ✅ valid field in Prisma schema
        slug,
        images: imagesInput.length
          ? {
              create: imagesInput.map((img, idx) => ({
                url: img.url,
                publicId: img.publicId ?? null,
                width: img.width ?? null,
                height: img.height ?? null,
                format: img.format ?? null,
                position: typeof img.position === "number" ? img.position : idx,
              })),
            }
          : undefined,
      },
      include: { images: { orderBy: { position: "asc" } } },
    });

    res.status(201).json({ ok: true, property });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? "Unexpected error" });
  }
});

export default router;
