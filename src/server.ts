// src/server.ts
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(morgan("tiny"));

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// List properties (with optional minPrice & maxPrice filters)
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
          orderBy: { position: "asc" }, // change to sortOrder if that’s your field name
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
          orderBy: { position: "asc" }, // change to sortOrder if that’s your field
        },
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

// Start server (Render will inject PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
});
