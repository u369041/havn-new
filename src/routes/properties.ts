// src/routes/properties.ts
import { Router } from "express";
import prisma from "../prisma"; // adjust path if needed

const router = Router();

// GET /api/properties  – list
router.get("/", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    res.json({ ok: true, properties });
  } catch (error) {
    console.error("Error fetching properties", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// GET /api/properties/:id  – detail
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const property = await prisma.property.findUnique({
      where: { id },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    res.json({ ok: true, property });
  } catch (error) {
    console.error("Error fetching property by id", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// POST /api/properties  – create
router.post("/", async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      status,
      propertyType,
      beds,
      baths,
      sizeSqm,
      addressLine1,
      addressLine2,
      city,
      county,
      eircode,
      latitude,
      longitude,
      mainImageUrl,
      imageUrls,
    } = req.body ?? {};

    const errors: string[] = [];

    if (!title) errors.push("title is required");
    if (!addressLine1) errors.push("addressLine1 is required");
    if (!city) errors.push("city is required");
    if (!eircode) errors.push("eircode is required");
    if (!status) errors.push("status is required (FOR_SALE / TO_RENT / TO_SHARE)");
    if (!propertyType) errors.push("propertyType is required (HOUSE / APARTMENT / etc)");

    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      errors.push("price must be a number");
    }
    if (beds === undefined || beds === null || Number.isNaN(Number(beds))) {
      errors.push("beds must be a number");
    }
    if (baths === undefined || baths === null || Number.isNaN(Number(baths))) {
      errors.push("baths must be a number");
    }

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      errors.push("imageUrls must contain at least one image");
    }

    if (!mainImageUrl) {
      errors.push("mainImageUrl is required (usually the first image)");
    }

    if (errors.length > 0) {
      return res.status(400).json({ ok: false, errors });
    }

    const property = await prisma.property.create({
      data: {
        title,
        description: description ?? "",
        price: Number(price),
        status,
        propertyType,
        beds: Number(beds),
        baths: Number(baths),
        sizeSqm: sizeSqm ? Number(sizeSqm) : null,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        county: county || null,
        eircode,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        mainImageUrl,
        imageUrls,
      },
    });

    return res.status(201).json({ ok: true, property });
  } catch (error) {
    console.error("Error creating property", error);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

export default router;
