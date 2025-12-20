import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * Simple admin guard using header token
 * Header: x-admin-token
 */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req.header("x-admin-token") || "").trim();
  const expected = (process.env.ADMIN_TOKEN || "").trim();

  if (!expected) {
    return res.status(500).json({ ok: false, message: "ADMIN_TOKEN not set" });
  }

  if (!token || token !== expected) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  next();
}

/**
 * GET /api/properties
 * List properties
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        lat: true,
        lng: true,
        price: true,
        bedrooms: true,
        bathrooms: true,
        propertyType: true,
        ber: true,
        berNo: true,
        saleType: true,
        status: true,
        photos: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ ok: true, items });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || "Failed to list properties" });
  }
});

/**
 * GET /api/properties/:slug
 * Property detail
 */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) {
      return res.status(400).json({ ok: false, message: "Missing slug" });
    }

    const item = await prisma.property.findUnique({
      where: { slug }
    });

    if (!item) {
      return res.status(404).json({ ok: false, message: "Property not found" });
    }

    res.json({ ok: true, item });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || "Failed to fetch property" });
  }
});

/**
 * POST /api/properties
 * Create property (admin only)
 */
router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};

    const slug = String(b.slug || "").trim();
    const title = String(b.title || "").trim();
    const address1 = String(b.address1 || "").trim();
    const address2 = b.address2 != null ? String(b.address2).trim() : null;
    const city = String(b.city || "").trim();
    const county = String(b.county || "").trim();
    const eircode = b.eircode != null ? String(b.eircode).trim() : null;

    const price = Number(b.price);
    const bedrooms = b.bedrooms != null ? Number(b.bedrooms) : null;
    const bathrooms = b.bathrooms != null ? Number(b.bathrooms) : null;

    const propertyType = String(b.propertyType || "").trim();
    const ber = b.ber != null ? String(b.ber).trim() : null;
    const berNo = b.berNo != null ? String(b.berNo).trim() : null;
    const saleType = b.saleType != null ? String(b.saleType).trim() : null;
    const status = b.status != null ? String(b.status).trim() : null;

    const description = b.description != null ? String(b.description) : null;
    const lat = b.lat != null && b.lat !== "" ? Number(b.lat) : null;
    const lng = b.lng != null && b.lng !== "" ? Number(b.lng) : null;

    const features = Array.isArray(b.features) ? b.features.map(String) : [];
    const photos = Array.isArray(b.photos) ? b.photos.map(String) : [];

    if (!slug || !title || !address1 || !city || !county || !propertyType) {
      return res.status(400).json({
        ok: false,
        message: "Missing required fields"
      });
    }

    if (!Number.isFinite(price)) {
      return res.status(400).json({ ok: false, message: "price must be a number" });
    }

    const created = await prisma.property.create({
      data: {
        slug,
        title,
        address1,
        address2,
        city,
        county,
        eircode,
        lat,
        lng,
        price,
        bedrooms,
        bathrooms,
        propertyType,
        ber,
        berNo,
        saleType,
        status,
        description,
        features,
        photos
      }
    });

    res.status(201).json({ ok: true, item: created });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }

    res.status(500).json({ ok: false, message: err?.message || "Create failed" });
  }
});

export default router;
