// src/routes/moderation.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { sendListingApprovedEmail, sendListingRejectedEmail } from "../lib/resendMail";
import jwt from "jsonwebtoken";

const router = Router();

/**
 * ✅ IMPORTANT:
 * Prisma expects Property.id as Int (number).
 * So we must parse req.params.id into a number.
 */

function requireAuth(req: any, res: any, next: any) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing token" });

    const secret = process.env.JWT_SECRET || "";
    if (!secret) return res.status(500).json({ ok: false, error: "JWT_SECRET missing" });

    const decoded = jwt.verify(token, secret) as any;
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

function requireAdmin(req: any, res: any, next: any) {
  const role = req.user?.role;
  if (role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });
  next();
}

function ensureSlug(s: string) {
  return (
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || `listing-${Date.now()}`
  );
}

function parseId(req: any, res: any) {
  const raw = req.params.id;
  const id = Number(raw);

  if (!raw || !Number.isFinite(id) || id <= 0) {
    res.status(400).json({
      ok: false,
      error: "Invalid id",
      detail: `Expected numeric id, got: ${raw}`,
    });
    return null;
  }

  return id;
}

/**
 * ✅ POST /api/admin/properties/:id/approve
 * Only SUBMITTED → PUBLISHED
 */
router.post("/properties/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;

    const prop = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!prop) return res.status(404).json({ ok: false, error: "Property not found" });

    const status = String(prop.status || "").toUpperCase();
    if (status !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        error: "Only SUBMITTED listings can be approved",
        status,
      });
    }

    const slug = prop.slug ? prop.slug : ensureSlug(prop.title || prop.address || String(prop.id));

    const updated = await prisma.property.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        slug,
        rejectedReason: null,
        approvedAt: new Date(),
      },
    });

    // ✅ Email owner
    const email = prop.user?.email;
    if (email) {
      await sendListingApprovedEmail(email, {
        title: updated.title || updated.address || updated.slug || "Your listing",
        slug: updated.slug!,
      });
    }

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("APPROVE ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message || "Approve failed" });
  }
});

/**
 * ✅ POST /api/admin/properties/:id/reject
 * Only SUBMITTED → REJECTED
 * Requires reason (optional in DB, but enforced in UI)
 */
router.post("/properties/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseId(req, res);
    if (!id) return;

    const reason = String(req.body?.reason || "").trim();

    const prop = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!prop) return res.status(404).json({ ok: false, error: "Property not found" });

    const status = String(prop.status || "").toUpperCase();
    if (status !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        error: "Only SUBMITTED listings can be rejected",
        status,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectedReason: reason || null,
        rejectedAt: new Date(),
      },
    });

    // ✅ Email owner with reject reason + edit link
    const email = prop.user?.email;
    if (email) {
      const editUrl = `https://havn.ie/property-upload.html?id=${encodeURIComponent(
        String(updated.id)
      )}`;
      await sendListingRejectedEmail(email, {
        title: updated.title || updated.address || updated.slug || "Your listing",
        reason,
        editUrl,
      });
    }

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("REJECT ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message || "Reject failed" });
  }
});

export default router;
