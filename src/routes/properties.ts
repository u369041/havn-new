// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { PrismaClient, ListingType, ListingStatus } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/properties
 * Basic list; no reference to sizeSqM anywhere
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { position: "asc" },
        },
      },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    console.error("Error fetching properties:", err?.message || err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/**
 * POST /api/properties
 * Creates a property with optional images
 *
 * Required minimal fields: title, price, listingType (SALE|RENT), slug (unique)
 * Optional: status (defaults to ACTIVE), and everything else
 *
 * Example body:
 * {
 *   "title": "Test",
 *   "price": 250000,
 *   "listingType": "SALE",
 *   "slug": "test-001",
 *   "images": [
 *     { "url": "https://...", "publicId": "demo", "position": 0 }
 *   ]
 * }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};

    // --- Minimal validation / coercion ---
    if (!body.title || typeof body.title !== "string") {
      return res.status(400).json({ ok: false, error: "title is required" });
    }
    if (typeof body.price !== "number" || Number.isNaN(body.price)) {
      return res.status(400).json({ ok: false, error: "price must be a number" });
    }
    if (!body.listingType || !["SALE", "RENT"].includes(body.listingType)) {
      return res.status(400).json({ ok: false, error: "listingType must be SALE or RENT" });
    }
    if (!body.slug || typeof body.slug !== "string") {
      return res.status(400).json({ ok: false, error: "slug is required" });
    }

    // Ensure enums are correctly typed
    const listingType = body.listingType as ListingType;
    const status = (body.status as ListingStatus) ?? "ACTIVE";

    // Prepare nested images create inputs (IMPORTANT: use undefined for omitted optionals)
    let imagesCreate:
      | {
          create:
            | {
                url: string;
                publicId?: string;
                width?: number;
                height?: number;
                format?: string;
                position?: number;
              }[]
            | {
                url: string;
                publicId?: string;
                width?: number;
                height?: number;
                format?: string;
                position?: number;
              };
        }
      | undefined;

    if (Array.isArray(body.images) && body.images.length > 0) {
      imagesCreate = {
        create: body.images.map((img: any) => {
          return {
            url: String(img.url),
            // leave these as undefined if not provided (NOT null)
            publicId:
              img.publicId === null || typeof img.publicId === "undefined"
                ? undefined
                : String(img.publicId),
            width:
              typeof img.width === "number" && !Number.isNaN(img.width)
                ? img.width
                : undefined,
            height:
              typeof img.height === "number" && !Number.isNaN(img.height)
                ? img.height
                : undefined,
            format:
              img.format === null || typeof img.format === "undefined"
                ? undefined
                : String(img.format),
            position:
              typeof img.position === "number" && !Number.isNaN(img.position)
                ? img.position
                : undefined,
          };
        }),
      };
    }

    const created = await prisma.property.create({
      data: {
        slug: body.slug,
        title: body.title,
        description:
          typeof body.description === "string" ? body.description : undefined,
        price: body.price,
        listingType,
        status,

        bedrooms:
          typeof body.bedrooms === "number" && !Number.isNaN(body.bedrooms)
            ? body.bedrooms
            : undefined,
        bathrooms:
          typeof body.bathrooms === "number" && !Number.isNaN(body.bathrooms)
            ? body.bathrooms
            : undefined,
        areaSqFt:
          typeof body.areaSqFt === "number" && !Number.isNaN(body.areaSqFt)
            ? body.areaSqFt
            : undefined,

        addressLine1:
          typeof body.addressLine1 === "string" ? body.addressLine1 : undefined,
        addressLine2:
          typeof body.addressLine2 === "string" ? body.addressLine2 : undefined,
        city: typeof body.city === "string" ? body.city : undefined,
        county: typeof body.county === "string" ? body.county : undefined,
        eircode: typeof body.eircode === "string" ? body.eircode : undefined,

        latitude:
          typeof body.latitude === "number" && !Number.isNaN(body.latitude)
            ? body.latitude
            : undefined,
        longitude:
          typeof body.longitude === "number" && !Number.isNaN(body.longitude)
            ? body.longitude
            : undefined,

        images: imagesCreate,
      },
      include: {
        images: { orderBy: { position: "asc" } },
      },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error("Create property error:", err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
