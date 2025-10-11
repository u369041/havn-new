// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/properties
 * List all properties (with images).
 */
router.get("/properties", async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ ok: true, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

/**
 * IMPORTANT: Put the slug route BEFORE the :id route so it does not get shadowed.
 *
 * GET /api/properties/slug/:slug
 * Fetch by slug.
 */
router.get("/properties/slug/:slug", async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    // Use findFirst to work even if slug is not marked @unique
    const property = await prisma.property.findFirst({
      where: { slug },
      include: { images: true },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    return res.json({ ok: true, property });
  } catch (err) {
    console.error("Error fetching property by slug:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch by slug" });
  }
});

/**
 * GET /api/properties/:id
 * Fetch by id (UUID).
 */
router.get("/properties/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const property = await prisma.property.findUnique({
      where: { id },
      include: { images: true },
    });
    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    return res.json({ ok: true, property });
  } catch (err) {
    console.error("Error fetching property by id:", err);
    return res.status(500).json({ ok: false, error: "Failed to fetch by id" });
  }
});

/**
 * POST /api/properties
 * Create a property. Minimal required fields: title, description, price, listingType, status, slug
 * Optional images: [{ url, publicId?, width?, height?, format?, position? }]
 */
router.post("/properties", async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      listingType,
      status,
      slug,
      images,
    } = req.body as {
      title: string;
      description?: string;
      price?: number;
      listingType?: "SALE" | "RENT";
      status?: "ACTIVE" | "ARCHIVED";
      slug: string;
      images?: Array<{
        url: string;
        publicId?: string | null;
        width?: number | null;
        height?: number | null;
        format?: string | null;
        position?: number | null;
      }>;
    };

    if (!title || !slug) {
      return res.status(400).json({ ok: false, error: "title and slug are required" });
    }

    // Prepare images (optional)
    let imagesCreate:
      | Prisma.PropertyImageCreateWithoutPropertyInput[]
      | undefined;

    if (Array.isArray(images) && images.length > 0) {
      imagesCreate = images.map((img) => ({
        url: img.url,
        publicId: img.publicId ?? undefined,
        width: img.width ?? undefined,
        height: img.height ?? undefined,
        format: img.format ?? undefined,
        position:
          typeof img.position === "number" ? img.position : undefined,
      }));
    }

    const data: Prisma.PropertyCreateInput = {
      title,
      description: description ?? "",
      price: typeof price === "number" ? price : 0,
      listingType: (listingType as any) ?? "SALE",
      status: (status as any) ?? "ACTIVE",
      slug,
      images: imagesCreate && imagesCreate.length > 0 ? { create: imagesCreate } : undefined,
    };

    const property = await prisma.property.create({
      data,
      include: { images: true },
    });

    return res.status(201).json({ ok: true, property });
  } catch (err: any) {
    // Handle unique constraint on slug gracefully if present
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, error: "Slug already exists" });
    }
    console.error("Error creating property:", err);
    return res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
