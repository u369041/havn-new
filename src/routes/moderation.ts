import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

const router = Router();

function parseId(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function makeSlugFallback(p: any) {
  return slugify(
    [
      p?.title || "listing",
      p?.county || "",
      p?.city || "",
      p?.eircode || "",
      p?.id,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function ensureAdmin(req: any) {
  // Your requireAuth middleware should attach user on req
  const role = req?.user?.role;
  return role === "admin";
}

/**
 * POST /api/admin/properties/:id/approve
 * Requires: listingStatus SUBMITTED -> PUBLISHED
 */
router.post("/properties/:id/approve", requireAuth, async (req: any, res) => {
  try {
    if (!ensureAdmin(req)) {
      return res.status(403).json({ ok: false, message: "Admin only" });
    }

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid id" });

    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (prop.listingStatus !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        message: `Cannot approve from ${prop.listingStatus}`,
      });
    }

    const slug = prop.slug && String(prop.slug).trim() ? prop.slug : makeSlugFallback(prop);

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: new Date(),
        approvedAt: new Date(),
        approvedById: req.user?.id ?? null,
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
        slug,
      },
    });

    return res.json({ ok: true, property: updated });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 * Requires: listingStatus SUBMITTED -> REJECTED
 * Body: { reason: string }
 */
router.post("/properties/:id/reject", requireAuth, async (req: any, res) => {
  try {
    if (!ensureAdmin(req)) {
      return res.status(403).json({ ok: false, message: "Admin only" });
    }

    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid id" });

    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ ok: false, message: "Reject reason required" });
    }

    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (prop.listingStatus !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        message: `Cannot reject from ${prop.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: req.user?.id ?? null,
        rejectedReason: reason,
      },
    });

    return res.json({ ok: true, property: updated });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
