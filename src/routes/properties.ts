// src/routes/properties.ts

import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import slugify from "slugify";

const router = Router();
const prisma = new PrismaClient();

// GET /api/properties -> list all (with optional filters)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { city, county, listingType, status, take = "20", skip = "0" } = req.query;

    const properties = await prisma.property.findMany({
      where: {
        city: city ? String(city) : undefined,
        county: county ? String(county) : undefined,
        listingType: listingType ? String(listingType).toUpperCase() as any : undefined,
        status: status ? String(status).toUpperCase() as any : "ACTIVE",
      },
      include: { images: true },
      take: parseInt(String(take)),
      skip: parseInt(String(skip)),
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

// GET /api/properties/:id -> single property
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const property = await prisma.property.findUnique({
      where: { id: req.params.id },
      include: { images: true },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    res.json({ ok: true, property });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

// POST /api/properties -> create new listing
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      listingType,
      bedrooms,
      bathrooms,
      areaSqFt,
      addressLine1,
      addressLine2,
      city,
      county,
      eircode,
      latitude,
      longitude,
      images,
    } = req.body;

    // Create slug from title
    const slug = slugify(title, { lower: true, strict: true });

    const property = await prisma.property.create({
      data: {
        title,
        description,
        price: Number(price),
        listingType,
        bedrooms,
        bathrooms,
        areaSqFt,
        addressLine1,
        addressLine2,
        city,
        county,
        eircode,
        latitude,
        longitude,
        slug,
        images: {
          create: images?.map((img: any, index: number) => ({
            publicId: img.publicId,
            url: img.url,
            width: img.width,
            height: img.height,
            format: img.format,
            position: index,
          })),
        },
      },
      include: { images: true },
    });

    res.status(201).json({ ok: true, property });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

export default router;
