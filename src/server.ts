// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(helmet());
app.use(cors({
  origin: [
    "https://havn.ie",
    "https://www.havn.ie",
    "https://havn-new.onrender.com"
  ],
  credentials: true,
}));
app.use(express.json());

// --- Routes ---

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "HAVN API is running" });
});

// Get all properties
app.get("/api/properties", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error("Failed to fetch properties", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

// Get property by slug
app.get("/api/properties/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: true }
    });
    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }
    res.json({ ok: true, property });
  } catch (err) {
    console.error("Failed to fetch property", err);
    res.status(500).json({ ok: false, error: "Failed to fetch property" });
  }
});

// Create new property
app.post("/api/properties", async (req, res) => {
  try {
    const { title, description, price, slug, images } = req.body;

    const property = await prisma.property.create({
      data: {
        title,
        description,
        price,
        slug,
        listingType: "SALE",
        status: "ACTIVE",
        city: "Dublin",
        county: "Dublin",
        images: {
          create: (images || []).map((img: any, idx: number) => ({
            url: img.url,
            publicId: img.publicId || `manual-${idx}`,
            format: img.format || "jpg",
            position: idx
          }))
        }
      },
      include: { images: true }
    });

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error("Failed to create property", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HAVN API running on http://localhost:${PORT}`);
});
