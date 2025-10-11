import { Router, Request, Response } from "express";
import {
  PrismaClient,
  ListingType,
  ListingStatus,
} from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/**
 * Shape of an incoming image in the request body.
 * We keep everything nullable because the DB allows nulls
 * and we coerce to nulls explicitly to satisfy Prisma types.
 */
type PropertyImageInput = {
  url: string;
  publicId?: string | null;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  position?: number | null;
};

/**
 * Shape of the POST /api/properties body
 * Only title, price and slug are required here for minimal create.
 * listingType/status default if not provided.
 */
type CreatePropertyBody = {
  title: string;
  price: number;
  slug: string;

  description?: string;

  // these can arrive as strings; we coerce to Prisma enums
  listingType?: ListingType | string;
  status?: ListingStatus | string;

  images?: PropertyImageInput[];
};

//
// GET /api/properties
//
router.get("/api/properties", async (_req: Request, res: Response) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

//
// POST /api/properties
//
router.post(
  "/api/properties",
  async (req: Request<unknown, unknown, CreatePropertyBody>, res: Response) => {
    try {
      const body = req.body;

      // Basic required field checks
      if (!body?.title || typeof body.title !== "string") {
        return res.status(400).json({ ok: false, error: "Missing title" });
      }
      if (
        body.price === undefined ||
        body.price === null ||
        Number.isNaN(Number(body.price))
      ) {
        return res.status(400).json({ ok: false, error: "Missing price" });
      }
      if (!body?.slug || typeof body.slug !== "string") {
        return res.status(400).json({ ok: false, error: "Missing slug" });
      }

      // Coerce enums safely (defaulting if missing)
      const listingType: ListingType = (
        (body.listingType as ListingType) ?? ListingType.SALE
      );
      const status: ListingStatus = (
        (body.status as ListingStatus) ?? ListingStatus.ACTIVE
      );

      // Map images with explicit typing to avoid implicit-any
      const imagesData =
        (body.images ?? []).map((img: PropertyImageInput) => ({
          url: img.url,
          publicId: img.publicId ?? null,
          width: img.width ?? null,
          height: img.height ?? null,
          format: img.format ?? null,
          position: img.position ?? null,
        })) || [];

      const created = await prisma.property.create({
        data: {
          title: body.title,
          price: Number(body.price),
          description: body.description ?? "",
          slug: body.slug,
          listingType,
          status,
          images: imagesData.length ? { create: imagesData } : undefined,
        },
        include: { images: true },
      });

      res.status(201).json({ ok: true, property: created });
    } catch (err: any) {
      console.error("Error creating property:", err);
      // Unique slug constraint etc.
      if (err?.code === "P2002") {
        return res
          .status(409)
          .json({ ok: false, error: "Slug already exists" });
      }
      res.status(500).json({ ok: false, error: "Failed to create property" });
    }
  }
);

export default router;
