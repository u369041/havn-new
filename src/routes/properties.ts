// src/routes/properties.ts
import { Router, Request, Response } from "express";
import { prisma } from "../db.js";
import { requireAdmin } from "../middleware/admin.js";

const r = Router();

// --- helpers ---
function slugify(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function send(res: Response, ok: boolean, payload: any = {}) {
  if (!ok) return res.status(400).json({ ok, ...payload });
  return res.json({ ok, ...payload });
}

// ---- LIST (basic) ----
r.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const items = await prisma.property.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { properties: items });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- GET by slug ----
r.get("/:slug", async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const property = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    if (!property) return res.status(404).json({ ok: false, error: "not_found" });
    return send(res, true, { property });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- CREATE property (admin) ----
r.post("/", requireAdmin, async (req, res) => {
  try {
    const {
      title, price, description, address, city, county, eircode,
      beds, baths, areaSqm, type, category, status
    } = req.body || {};
    const slug = slugify(`${title}-${city || ""}-${county || ""}`);
    const created = await prisma.property.create({
      data: {
        slug, title, price: Number(price || 0), description: description || "",
        address, city, county, eircode, beds, baths, areaSqm,
        type, status: status || "ACTIVE", // PropertyStatus
        // optional category persisted as string column via Prisma schema extension,
        // or compute from status; adjust if needed.
        // @ts-ignore
        category: category || "BUY",
      },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { property: created });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- UPDATE property (admin) ----
r.put("/:slug", requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const exists = await prisma.property.findUnique({ where: { slug } });
    if (!exists) return res.status(404).json({ ok: false, error: "not_found" });

    const {
      title, price, description, address, city, county, eircode,
      beds, baths, areaSqm, type, category, status
    } = req.body || {};

    const updated = await prisma.property.update({
      where: { slug },
      data: {
        title: title ?? exists.title,
        price: price !== undefined ? Number(price) : exists.price,
        description: description ?? exists.description,
        address: address ?? exists.address,
        city: city ?? exists.city,
        county: county ?? exists.county,
        eircode: eircode ?? exists.eircode,
        beds: beds ?? exists.beds,
        baths: baths ?? exists.baths,
        areaSqm: areaSqm ?? exists.areaSqm,
        type: type ?? exists.type,
        // @ts-ignore
        category: category ?? (exists as any).category ?? "BUY",
        status: status ?? exists.status,
      },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { property: updated });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- DELETE property (admin) ----
r.delete("/:slug", requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const exists = await prisma.property.findUnique({ where: { slug } });
    if (!exists) return res.status(404).json({ ok: false, error: "not_found" });

    await prisma.propertyImage.deleteMany({ where: { propertyId: exists.id } });
    await prisma.property.delete({ where: { slug } });
    return send(res, true, { ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- IMAGES: REORDER (admin) ----
// body: { reorder: [{id:number, sort:number}, ...] }
r.patch("/:slug/images", requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const { reorder } = req.body || {};
    const prop = await prisma.property.findUnique({ where: { slug } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });
    if (!Array.isArray(reorder)) return res.status(400).json({ ok: false, error: "invalid_reorder" });

    // Update many; run in a transaction.
    await prisma.$transaction(
      reorder.map((r: any) =>
        prisma.propertyImage.update({ where: { id: Number(r.id) }, data: { sort: Number(r.sort || 0) } })
      )
    );

    const fresh = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { property: fresh });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- IMAGES: ADD (admin) ----
// body: { images: [{ url, width?, height?, alt? }] }
r.post("/:slug/images", requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const prop = await prisma.property.findUnique({ where: { slug }, include: { images: true } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });

    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ ok: false, error: "no_images" });

    // Determine starting sort
    const start = (prop.images?.length || 0);
    const data = images.map((img: any, i: number) => ({
      propertyId: prop.id,
      url: String(img.url),
      width: img.width ? Number(img.width) : null,
      height: img.height ? Number(img.height) : null,
      alt: img.alt ? String(img.alt) : null,
      sort: start + i,
    }));

    await prisma.propertyImage.createMany({ data });

    const fresh = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { property: fresh });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

// ---- IMAGES: DELETE one (admin) ----
r.delete("/:slug/images/:id", requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.slug);
    const id = Number(req.params.id);
    const prop = await prisma.property.findUnique({ where: { slug }, include: { images: true } });
    if (!prop) return res.status(404).json({ ok: false, error: "not_found" });

    const found = prop.images.find(im => im.id === id);
    if (!found) return res.status(404).json({ ok: false, error: "image_not_found" });

    await prisma.propertyImage.delete({ where: { id } });

    // Re-pack sorts 0..N-1
    const rest = await prisma.propertyImage.findMany({ where: { propertyId: prop.id }, orderBy: { sort: "asc" } });
    await prisma.$transaction(
      rest.map((im, idx) => prisma.propertyImage.update({ where: { id: im.id }, data: { sort: idx } }))
    );

    const fresh = await prisma.property.findUnique({
      where: { slug },
      include: { images: { orderBy: { sort: "asc" } } },
    });
    return send(res, true, { property: fresh });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

export default r;
