import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/* ------------------------------ Helpers ------------------------------ */

function asNumber(val: any): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function asEnum<T extends string>(val: any, allowed: readonly T[]): T | undefined {
  return typeof val === "string" && (allowed as readonly string[]).includes(val)
    ? (val as T)
    : undefined;
}

function toUndefined<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

/** Build safe nested images create object for Prisma */
function buildImagesCreate(images: any[] | undefined) {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const create = images
    .map((img) => {
      if (!img || typeof img !== "object") return undefined;
      const url = typeof img.url === "string" ? img.url.trim() : "";
      if (!url) return undefined; // url is required for an image

      return {
        url,
        publicId: toUndefined(typeof img.publicId === "string" ? img.publicId : undefined),
        width: toUndefined(asNumber(img.width)),
        height: toUndefined(asNumber(img.height)),
        format: toUndefined(typeof img.format === "string" ? img.format : undefined),
        position: toUndefined(asNumber(img.position)),
      };
    })
    .filter(Boolean) as {
      url: string;
      publicId?: string;
      width?: number;
      height?: number;
      format?: string;
      position?: number;
    }[];

  return create.length ? { create } : undefined;
}

/* ------------------------------ GET / ------------------------------ */
/**
 * List properties with optional filters:
 *   /api/properties?search=&type=SALE|RENT&status=ACTIVE|DRAFT|ARCHIVED&minPrice=&maxPrice=&city=&county=
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { search, type, status, city, county, minPrice, maxPrice } = req.query;

    const where: any = {};

    const listingType = asEnum(type, Object.values(ListingType) as readonly ListingType[]);
    if (listingType) where.listingType = listingType;

    const listingStatus = asEnum(status, Object.values(ListingStatus) as readonly ListingStatus[]);
    if (listingStatus) where.status = listingStatus;

    const minP = asNumber(minPrice);
    const maxP = asNumber(maxPrice);
    if (minP != null || maxP != null) {
      where.price = {};
      if (minP != null) where.price.gte = minP;
      if (maxP != null) where.price.lte = maxP;
    }

    if (typeof city === "string" && city.trim()) {
      where.city = { contains: city.trim(), mode: "insensitive" };
    }
    if (typeof county === "string" && county.trim()) {
      where.county = { contains: county.trim(), mode: "insensitive" };
    }

    if (typeof search === "string" && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { addressLine1: { contains: q, mode: "insensitive" } },
        { addressLine2: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { county: { contains: q, mode: "insensitive" } },
        { eircode: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
      ];
    }

    const properties = await prisma.property.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        images: { orderBy: { position: "asc" } },
      },
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    console.error("Error fetching properties:", err?.message || err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/* ------------------------------ GET /:slug ------------------------------ */

router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    if (!slug) return res.status(400).json({ ok: false, error: "Missing slug" });

    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { position: "asc" } } },
    });

    if (!property) return res.status(404).json({ ok: false, error: "Not found" });

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error("Error fetching property:", err?.message || err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

/* ------------------------------ POST / ------------------------------ */
/**
 * Create property.
 * Minimal required: title, price, listingType, slug
 * Optional: description, status, addressLine1, addressLine2, city, county, eircode, bedrooms, bathrooms,
 * latitude, longitude, images[]
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};

    // Required
    const title = typeof b.title === "string" ? b.title.trim() : "";
    const price = asNumber(b.price);
    const slug = typeof b.slug === "string" ? b.slug.trim() : "";
    const listingType = asEnum(b.listingType, Object.values(ListingType) as readonly ListingType[]);
    if (!title || !price || !slug || !listingType) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: title, price, slug, listingType",
      });
    }

    // Optional enums / strings / numbers
    const status = asEnum(b.status, Object.values(ListingStatus) as readonly ListingStatus[]);
    const description = typeof b.description === "string" ? b.description : undefined;

    const addressLine1 = typeof b.addressLine1 === "string" ? b.addressLine1 : undefined;
    const addressLine2 = typeof b.addressLine2 === "string" ? b.addressLine2 : undefined;
    const city = typeof b.city === "string" ? b.city : undefined;
    const county = typeof b.county === "string" ? b.county : undefined;
    const eircode = typeof b.eircode === "string" ? b.eircode : undefined;

    const bedrooms = asNumber(bedroomsFrom(b));
    const bathrooms = asNumber(b.bathrooms);

    const latitude = asNumber(b.latitude);
    const longitude = asNumber(b.longitude);

    // Images nested create (omit nulls)
    const imagesNested = buildImagesCreate(b.images);

    const created = await prisma.property.create({
      data: {
        title,
        price,
        slug,
        listingType,
        status: status ?? ListingStatus.ACTIVE,

        description,
        addressLine1,
        addressLine2,
        city,
        county,
        eircode,

        bedrooms,
        bathrooms,

        latitude,
        longitude,

        images: imagesNested, // will be undefined if none or invalid
      },
      include: { images: { orderBy: { position: "asc" } } },
    });

    return res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error("Error creating property:", err?.message || err);
    // Surface Prisma known request error message if present
    const msg: string =
      err?.meta?.cause ||
      err?.message ||
      "Failed to create property";
    res.status(500).json({ ok: false, error: msg });
  }
});

/* bedrooms can arrive as number or string (e.g. "4 Bed") in some feeds */
function bedroomsFrom(b: any): number | undefined {
  if (b?.bedrooms == null) return undefined;
  const raw = typeof b.bedrooms === "string" ? b.bedrooms : String(b.bedrooms);
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/* ------------------------------ Export ------------------------------ */

export default router;
