import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/properties
 * Returns the latest properties. 404 if none exist.
 */
router.get("/api/properties", async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    if (!properties.length) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    return res.json({ ok: true, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/**
 * POST /api/properties
 * Creates a property. Minimal required fields: slug, title, price, listingType.
 * Example body:
 * {
 *   "slug": "ps-test-0018",
 *   "title": "Test Property 0018",
 *   "description": "Created from PowerShell – unique slug test",
 *   "price": 375000,
 *   "listingType": "SALE",
 *   "status": "ACTIVE",
 *   "images": [
 *     { "url": "https://res.cloudinary.com/demo/image/upload/sample.jpg",
 *       "publicId": "test-0018",
 *       "format": "jpg",
 *       "position": 0
 *     }
 *   ]
 * }
 */
router.post("/api/properties", async (req: Request, res: Response) => {
  try {
    const b: any = req.body ?? {};

    // Coerce enums safely (fallbacks keep us inside allowed values)
    const listingType: ListingType =
      b.listingType === "RENT" ? ListingType.RENT : ListingType.SALE;

    const status: ListingStatus =
      b.status === "ACTIVE"
        ? ListingStatus.ACTIVE
        : b.status === "ARCHIVED"
        ? ListingStatus.ARCHIVED
        : ListingStatus.ACTIVE;

    // Optional images (map only allowed fields)
    const imagesCreate =
      Array.isArray(b.images) && b.images.length
        ? b.images
            .filter((img: any) => img && img.url && img.publicId)
            .map((img: any) => ({
              url: String(img.url),
              publicId: String(img.publicId), // required by schema
              width: typeof img.width === "number" ? img.width : null,
              height: typeof img.height === "number" ? img.height : null,
              format: img.format ? String(img.format) : null,
              // Prisma type for position is number | undefined (NOT null)
              position:
                typeof img.position === "number" ? (img.position as number) : undefined,
            }))
        : undefined;

    const data: any = {
      slug: String(b.slug),
      title: String(b.title),
      description: b.description ?? null,
      price: typeof b.price === "number" ? b.price : null,
      listingType,
      status,
      bedrooms: typeof b.bedrooms === "number" ? b.bedrooms : null,
      bathrooms: typeof b.bathrooms === "number" ? b.bathrooms : null,
      areaSqFt: typeof b.areaSqFt === "number" ? b.areaSqFt : null,
      addressLine1: b.addressLine1 ?? null,
      addressLine2: b.addressLine2 ?? null,
      city: b.city ?? null,
      county: b.county ?? null,
      eircode: b.eircode ?? null,
      latitude: typeof b.latitude === "number" ? b.latitude : null,
      longitude: typeof b.longitude === "number" ? b.longitude : null,
    };

    if (imagesCreate && imagesCreate.length) {
      data.images = { create: imagesCreate };
    }

    const property = await prisma.property.create({
      data,
      include: { images: true },
    });

    return res.status(201).json({ ok: true, property });
  } catch (err: any) {
    // Handle Prisma unique constraint (e.g., slug)
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: "Slug already exists" });
    }
    console.error("Error creating property:", err);
    return res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
