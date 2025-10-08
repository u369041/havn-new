// src/server.ts
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient, ListingStatus, ListingType } from "@prisma/client";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// Load package.json without JSON import assertions
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
);

// Middleware
app.use(helmet());
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://havn.ie",
      "https://www.havn.ie",
      "https://havn-new.onrender.com",
    ],
    credentials: true,
  })
);

// Rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "havn-api",
    version: pkg.version,
    timestamp: new Date().toISOString(),
  });
});

// List properties
app.get("/api/properties", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: { orderBy: { position: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

// Create property (REQUIRED: title, price, listingType, slug)
app.post("/api/properties", async (req, res) => {
  try {
    const {
      title,
      price,
      description,
      listingType,
      slug,
      status,
      images = [],
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
    } = req.body ?? {};

    // Validate required fields
    const errors: string[] = [];
    if (!title) errors.push("title");
    if (price == null) errors.push("price");
    if (!listingType) errors.push("listingType");
    if (!slug) errors.push("slug");

    // Validate enum values when provided
    if (
      listingType &&
      !Object.values(ListingType).includes(String(listingType) as ListingType)
    ) {
      errors.push(`listingType must be one of ${Object.values(ListingType).join(", ")}`);
    }
    if (
      status &&
      !Object.values(ListingStatus).includes(String(status) as ListingStatus)
    ) {
      errors.push(`status must be one of ${Object.values(ListingStatus).join(", ")}`);
    }

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing/invalid fields: ${errors.join(", ")}`,
      });
    }

    // Prepare images with sequential positions
    const preparedImages =
      Array.isArray(images) && images.length
        ? images.map((img: any, i: number) => ({
            url: String(img.url),
            publicId: String(img.publicId),
            width: img.width ?? null,
            height: img.height ?? null,
            format: img.format ?? null,
            position: img.position ?? i,
          }))
        : [];

    const created = await prisma.property.create({
      data: {
        title: String(title),
        price: Number(price),
        description: description ?? "", // Prisma requires description
        listingType: String(listingType) as ListingType,
        slug: String(slug),
        status: (status as ListingStatus) ?? ListingStatus.ACTIVE,
        bedrooms: bedrooms ?? null,
        bathrooms: bathrooms ?? null,
        areaSqFt: areaSqFt ?? null,
        addressLine1: addressLine1 ?? null,
        addressLine2: addressLine2 ?? null,
        city: city ?? null,
        county: county ?? null,
        eircode: eircode ?? null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        images: preparedImages.length ? { create: preparedImages } : undefined,
      },
      include: { images: { orderBy: { position: "asc" } } },
    });

    res.status(201).json({ ok: true, property: created });
  } catch (err: any) {
    console.error("Error creating property:", err);
    // Surface unique constraint errors nicely (e.g., slug must be unique)
    if (err?.code === "P2002") {
      return res.status(409).json({
        ok: false,
        error: `Unique constraint failed on: ${err.meta?.target?.join?.(", ") || "field"}`,
      });
    }
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 havn API running on http://localhost:${PORT}`);
});
