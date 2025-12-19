// src/routes/properties.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authRequired, AuthRequest } from "../middleware/auth.js";

const prisma = new PrismaClient();
const router = Router();

// GET ALL PROPERTIES
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;

    const [count, properties] = await Promise.all([
      prisma.property.count(),
      prisma.property.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load properties" });
  }
});

// GET PROPERTY BY SLUG
router.get("/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    const property = await prisma.property.findUnique({
      where: { slug },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to load property" });
  }
});

// CREATE PROPERTY (AUTH REQUIRED)
router.post("/", authRequired, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body;

    const property = await prisma.property.create({
      data: {
        slug: body.slug,
        title: body.title,
        address1: body.address1,
        address2: body.address2 || "",
        city: body.city,
        county: body.county,
        eircode: body.eircode,
        price: Number(body.price),
        status: body.status,
        propertyType: body.propertyType,
        bedrooms: body.bedrooms ? Number(body.bedrooms) : null,
        bathrooms: body.bathrooms ? Number(body.bathrooms) : null,
        size: body.size ? Number(body.size) : null,
        sizeUnits: body.sizeUnits || "sqm",
        features: Array.isArray(body.features) ? body.features : [],
        description: body.description || "",
        photos: body.photos,
        userId,
      },
    });

    res.status(201).json({ ok: true, property });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
