import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

function requireAdmin(req: any, res: any, next: any) {
  const token = req.header("x-admin-token");
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    return res.status(500).json({ ok: false, message: "ADMIN_TOKEN not set" });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }
  next();
}

// GET /api/properties  (list)
router.get("/", async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "Failed to list properties" });
  }
});

// ✅ GET /api/properties/slug/:slug  (detail)
router.get("/slug/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, message: "Missing slug" });

    const item = await prisma.property.findUnique({ where: { slug } });
    if (!item) return res.status(404).json({ ok: false, message: "Not found" });

    res.json(item);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "Failed to load property" });
  }
});

// POST /api/properties  (create)
router.post("/", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};

    const required = ["slug", "title", "address1", "city", "county", "price", "status"];
    const missing = required.filter(
      (k) => b[k] === undefined || b[k] === null || String(b[k]).trim() === ""
    );
    if (missing.length) {
      return res.status(400).json({ ok: false, message: `Missing: ${missing.join(", ")}` });
    }

    const created = await prisma.property.create({
      data: {
        slug: String(b.slug),
        title: String(b.title),
        address1: String(b.address1),
        address2: b.address2 ? String(b.address2) : null,
        city: String(b.city),
        county: String(b.county),
        eircode: b.eircode ? String(b.eircode) : null,
        price: Number(b.price),
        status: String(b.status),

        propertyType: b.propertyType ? String(b.propertyType) : null,
        ber: b.ber ? String(b.ber) : null,
        bedrooms: b.bedrooms != null ? Number(b.bedrooms) : null,
        bathrooms: b.bathrooms != null ? Number(b.bathrooms) : null,
        size: b.size != null ? Number(b.size) : null,
        sizeUnits: b.sizeUnits ? String(b.sizeUnits) : null,

        features: Array.isArray(b.features) ? b.features.map(String) : [],
        description: b.description ? String(b.description) : null,
        photos: Array.isArray(b.photos) ? b.photos.map(String) : [],
      },
    });

    res.status(201).json(created);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).json({ ok: false, message: "Slug already exists" });
    }
    res.status(500).json({ ok: false, message: e?.message || "Create failed" });
  }
});

export default router;
