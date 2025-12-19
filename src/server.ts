import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();
const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const ALLOWED_ORIGINS: string[] = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

// ---------- MIDDLEWARE ----------
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

// ---------- HEALTH CHECK ----------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// ---------- DEBUG DB (TEMP, SAFE TYPES ONLY) ----------
app.get("/api/debug/db", async (_req: Request, res: Response) => {
  try {
    const currentRows: any = await prisma.$queryRawUnsafe(
      `select current_database()::text as db, current_schema()::text as schema;`,
    );

    const tableRows: any = await prisma.$queryRawUnsafe(
      `select exists (
         select 1
         from information_schema.tables
         where table_schema='public' and table_name='Property'
       )::text as property_table_exists;`,
    );

    const cols: any = await prisma.$queryRawUnsafe(
      `select column_name::text as column_name
       from information_schema.columns
       where table_schema='public' and table_name='Property'
       order by column_name;`,
    );

    return res.json({
      ok: true,
      current: currentRows?.[0] ?? null,
      property_table_exists: tableRows?.[0]?.property_table_exists ?? null,
      property_columns: Array.isArray(cols) ? cols.map((r) => r.column_name) : [],
    });
  } catch (err: any) {
    console.error("DEBUG /api/debug/db error", err);
    return res.status(500).json({
      ok: false,
      error: "debug failed",
      debugCode: err?.code ?? null,
      debugMessage: err?.message ?? String(err),
    });
  }
});

// ======================================================
//  CLOUDINARY SIGNATURE ENDPOINT
// ======================================================
app.all("/api/uploads/cloudinary-signature", (req: Request, res: Response) => {
  try {
    const folder =
      (req.body &&
        typeof req.body.folder === "string" &&
        req.body.folder.trim()) ||
      "properties";

    if (!CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({
        ok: false,
        error: "Cloudinary is not configured on the server",
      });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;

    const signature = crypto
      .createHash("sha1")
      .update(paramsToSign + CLOUDINARY_API_SECRET)
      .digest("hex");

    return res.json({
      ok: true,
      signature,
      timestamp,
      cloudName: CLOUDINARY_CLOUD_NAME,
    });
  } catch (err) {
    console.error("Error generating Cloudinary signature", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to generate Cloudinary signature",
    });
  }
});

// ================================
//  PROPERTIES ROUTES
// ================================
function parseIntSafe(v: any, fallback: number) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

const PROPERTY_SELECT = {
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
  propertyType: true,
  ber: true,
  bedrooms: true,
  bathrooms: true,
  size: true,
  sizeUnits: true,
  features: true,
  description: true,
  photos: true,
  createdAt: true,
} as const;

// GET /api/properties
app.get("/api/properties", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseIntSafe(req.query.limit, 20), 100);
    const offset = Math.max(parseIntSafe(req.query.offset, 0), 0);
    const status = (req.query.status as string | undefined) || undefined;

    const where: any = {};
    if (status) where.status = status;

    const [count, properties] = await Promise.all([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: PROPERTY_SELECT,
      }),
    ]);

    return res.json({ ok: true, count, properties });
  } catch (err: any) {
    console.error("GET /api/properties error", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch properties",
      debugCode: err?.code ?? null,
      debugMessage: err?.message ?? String(err),
    });
  }
});

// GET /api/properties/:slug
app.get("/api/properties/:slug", async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug;

    const property = await prisma.property.findUnique({
      where: { slug },
      select: PROPERTY_SELECT,
    });

    if (!property) {
      return res.status(404).json({ ok: false, error: "Property not found" });
    }

    return res.json({ ok: true, property });
  } catch (err: any) {
    console.error("GET /api/properties/:slug error", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to fetch property",
      debugCode: err?.code ?? null,
      debugMessage: err?.message ?? String(err),
    });
  }
});

// POST /api/properties
app.post("/api/properties", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};

    const requiredFields = [
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
    ] as const;

    for (const f of requiredFields) {
      const v = body[f];
      if (
        v === undefined ||
        v === null ||
        (typeof v === "string" && !v.trim())
      ) {
        return res.status(400).json({
          ok: false,
          error: `Missing required field: ${f}`,
        });
      }
    }

    if (!Array.isArray(body.photos) || body.photos.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "At least one photo is required",
      });
    }

    const features: string[] = Array.isArray(body.features)
      ? body.features
      : typeof body.features === "string"
      ? body.features
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
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
        propertyType: body.propertyType,
        ber: body.ber || null,
        bedrooms: body.bedrooms !== undefined ? Number(body.bedrooms) : null,
        bathrooms: body.bathrooms !== undefined ? Number(body.bathrooms) : null,
        size: body.size !== undefined ? Number(body.size) : null,
        sizeUnits: body.sizeUnits || "sqm",
        features,
        description: body.description || "",
        photos: body.photos,
      },
      select: PROPERTY_SELECT,
    });

    return res.status(201).json({ ok: true, property });
  } catch (err: any) {
    console.error("POST /api/properties error", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to create property",
      debugCode: err?.code ?? null,
      debugMessage: err?.message ?? String(err),
    });
  }
});

// 404 fallback
app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: "Not found",
    path: req.path,
  });
});

app.listen(PORT, () => {
  console.log(`HAVN API listening on port ${PORT}`);
});
