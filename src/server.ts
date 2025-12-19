import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const ALLOWED_ORIGINS = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

// --------------------
// MIDDLEWARE
// --------------------

app.use(helmet());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  }),
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(express.json());

app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// --------------------
// HEALTH CHECK
// --------------------

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// --------------------------------------------------
// CLOUDINARY SIGNATURE (STEP 1 UPLOAD)
// --------------------------------------------------

app.all("/api/uploads/cloudinary-signature", (req: Request, res: Response) => {
  try {
    const folder =
      (req.body?.folder && String(req.body.folder).trim()) || "properties";

    if (!CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({
        ok: false,
        error: "Cloudinary is not configured",
      });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + CLOUDINARY_API_SECRET)
      .digest("hex");

    res.json({
      ok: true,
      signature,
      timestamp,
      cloudName: CLOUDINARY_CLOUD_NAME,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "Signature error" });
  }
});

// --------------------
// PROPERTIES
// --------------------

function parseIntSafe(v: any, fallback: number) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

// GET /api/properties
app.get("/api/properties", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseIntSafe(req.query.limit, 20), 100);
    const offset = Math.max(parseIntSafe(req.query.offset, 0), 0);

    const [count, properties] = await Promise.all([
      prisma.property.count(),
      prisma.property.findMany({
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          slug: true,
          title: true,
          address1: true,
          address2: true,
          city: true,
          county: true,
          eircode: true,
          price: true,
          status: true,
          ber: true,
          bedrooms: true,
          bathrooms: true,
          size: true,
          sizeUnits: true,
          features: true,
          description: true,
          photos: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({ ok: true, count, properties });
  } catch (err: any) {
    console.error("GET /api/properties", err);
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Failed to fetch properties",
      code: err?.code ?? null,
    });
  }
});

// GET /api/properties/:slug
app.get("/api/properties/:slug", async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;

    const property = await prisma.property.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        address1: true,
        address2: true,
        city: true,
        county: true,
        eircode: true,
        price: true,
        status: true,
        ber: true,
        bedrooms: true,
        bathrooms: true,
        size: true,
        sizeUnits: true,
        features: true,
        description: true,
        photos: true,
        createdAt: true,
      },
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    res.json({ ok: true, property });
  } catch (err: any) {
    console.error("GET /api/properties/:slug", err);
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Failed to fetch property",
      code: err?.code ?? null,
    });
  }
});

// POST /api/properties
app.post("/api/properties", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    const required = [
      "slug",
      "title",
      "address1",
      "city",
      "county",
      "eircode",
      "price",
      "status",
      "propertyType",
      "photos",
    ];

    for (const f of required) {
      if (!body[f] || (typeof body[f] === "string" && !body[f].trim())) {
        return res.status(400).json({
          ok: false,
          error: `Missing field: ${f}`,
        });
      }
    }

    if (!Array.isArray(body.photos) || body.photos.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "At least one photo is required",
      });
    }

    const features = Array.isArray(body.features)
      ? body.features
      : typeof body.features === "string"
      ? body.features.split(",").map((s: string) => s.trim())
      : [];

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
        ber: body.ber || null,
        bedrooms: body.bedrooms ? Number(body.bedrooms) : null,
        bathrooms: body.bathrooms ? Number(body.bathrooms) : null,
        size: body.size ? Number(body.size) : null,
        sizeUnits: body.sizeUnits || "sqm",
        features,
        description: body.description || "",
        photos: body.photos,
      },
    });

    res.status(201).json({ ok: true, property });
  } catch (err: any) {
    console.error("POST /api/properties", err);
    res.status(500).json({
      ok: false,
      error: err?.message ?? "Failed to create property",
      code: err?.code ?? null,
    });
  }
});

// --------------------
// 404
// --------------------

app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// --------------------
// START
// --------------------

app.listen(PORT, () => {
  console.log(`HAVN API running on port ${PORT}`);
});
