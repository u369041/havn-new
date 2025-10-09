// src/server.ts
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Tiny request logger (replaces morgan)
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// List properties (supports ?minPrice=&maxPrice=)
app.get("/api/properties", async (req, res) => {
  try {
    const { minPrice, maxPrice } = req.query;
    const where: any = {};
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }

    const properties = await prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          // use { sortOrder: "asc" } if that's your column name
          orderBy: { position: "asc" },
        },
      },
    });

    res.json({ ok: true, count: properties.length, properties });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

// Get single property by slug
app.get("/api/properties/:slug", async (req, res) => {
  try {
    const { slug } = req.params;

    const property = await prisma.property.findUnique({
      where: { slug },
      include: {
        images: {
          // use { sortOrder: "asc" } if that's your column name
          orderBy: { position: "asc" },
        },
      },
    });

    if (!property) return res.status(404).json({ ok: false, error: "Not found" });

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
