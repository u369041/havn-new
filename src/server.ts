import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// ✅ safely load package.json without "assert { type: 'json' }"
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
);

// Middleware
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://havn.ie",
    "https://www.havn.ie",
    "https://havn-new.onrender.com"
  ],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests/min
});
app.use(limiter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "havn-api",
    version: pkg.version,
    timestamp: new Date().toISOString(),
  });
});

// Example: fetch properties
app.get("/api/properties", async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, count: properties.length, properties });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch properties" });
  }
});

// Example: create property
app.post("/api/properties", async (req, res) => {
  try {
    const { title, price, description, images } = req.body;

    if (!title || !price) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const property = await prisma.property.create({
      data: {
        title,
        price,
        description: description || "",
        images: images?.length
          ? { create: images.map((img: any, i: number) => ({
              url: img.url,
              publicId: img.publicId,
              width: img.width,
              height: img.height,
              format: img.format,
              position: img.position ?? i,
            })) }
          : undefined,
      },
      include: { images: { orderBy: { position: "asc" } } },
    });

    res.json({ ok: true, property });
  } catch (err) {
    console.error("Error creating property:", err);
    res.status(500).json({ ok: false, error: "Failed to create property" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 havn API running on http://localhost:${PORT}`);
});
