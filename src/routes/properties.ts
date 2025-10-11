import { Router } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Utility: map request body to prisma create data safely
function buildCreateData(body: any) {
  const {
    title,
    description,
    price,
    listingType,
    status,
    slug,
    addressLine1,
    addressLine2,
    city,
    county,
    eircode,
    bedrooms,
    bathrooms,
    areaSqFt,
    latitude,
    longitude,
    images, // optional array
  } = body ?? {};

  // Basic validations for required fields
  if (!title || !slug || !price || !listingType) {
    return { error: "title, slug, price, and listingType are required" } as const;
  }

  // Validate enum values (fallback to existing enums)
  const safeListingType =
    listingType === "SALE" || listingType === "RENT" ? (listingType as ListingType) : undefined;
  if (!safeListingType) {
    return { error: "listingType must be SALE or RENT" } as const;
  }

  const safeStatus: ListingStatus =
    status === "ACTIVE" || status === "DRAFT" || status === "ARCHIVED"
      ? (status as ListingStatus)
      : "ACTIVE";

  // Prepare images create list (optional)
  let imagesCreate:
    | {
        url: string;
        publicId: string;
        width?: number | null;
        height?: number | null;
        format?: string | null;
        position?: number | null;
      }[]
    | undefined;

  if (Array.isArray(images) && images.length > 0) {
    imagesCreate = images
      .filter((img) => img && typeof img.url === "string" && typeof img.publicId === "string")
      .map((img) => ({
        url: String(img.url),
        publicId: String(img.publicId),
        width: img.width ?? null,
        height: img.height ?? null,
        format: img.format ?? null,
        // Prisma type expects number | undefined for optional, but null is fine if your schema allows nulls.
        position: typeof img.position === "number" ? img.position : 0,
      }));
  }

  return {
    data: {
      title: String(title),
      description: description ?? null,
      price: Number(price),
      listingType: safeListingType,
      status: safeStatus,
      slug: String(slug),
      addressLine1: addressLine1 ?? null,
      addressLine2: addressLine2 ?? null,
      city: city ?? null,
      county: county ?? null,
      eircode: eircode ?? null,
      bedrooms: bedrooms ?? null,
      bathrooms: bathrooms ?? null,
      areaSqFt: areaSqFt ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      ...(imagesCreate && imagesCreate.length
        ? {
            images: {
              create: imagesCreate,
            },
          }
        : {}),
    },
  } as const;
}

// GET /api/properties  -> list
router.get("/properties", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        images: true,
      },
    });

    if (!properties || properties.length === 0) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// GET /api/properties/slug/:slug -> single by slug
router.get("/properties/slug/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: true },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error("Error fetching property by slug:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

// POST /api/properties -> create
router.post("/properties", async (req, res) => {
  try {
    const built = buildCreateData(req.body);
    if ("error" in built) {
      return res.status(400).json({ ok: false, error: built.error });
    }

    const created = await prisma.property.create({
      data: built.data,
      include: { images: true },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    // Prisma known error handling (e.g., unique slug)
    if (err?.code === "P2002" || err?.meta?.target?.includes("slug")) {
      return res.status(409).json({ ok: false, error: "Slug must be unique" });
    }
    console.error("Error creating property:", err);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  }
});

export default router;
