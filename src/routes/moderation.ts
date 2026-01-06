// src/routes/moderation.ts
import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { sendListingApprovedEmail, sendListingRejectedEmail } from "../lib/resendmail";

const router = Router();

/**
 * ✅ Minimal JWT auth middleware
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

/**
 * ✅ Admin-only middleware
 */
function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

/**
 * ✅ Generate a safe slug if missing
 */
function ensureSlug(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || `listing-${Date.now()}`;
}

/**
 * ✅ Helper: check if a field exists on Property model at runtime
 * avoids prisma update errors when schema doesn't include columns
 */
function propertyHasField(fieldName: string): boolean {
  try {
    const model = (prisma as any)._dmmf?.modelMap?.Property;
    const fields = model?.fields || [];
    return fields.some((f: any) => f.name === fieldName);
  } catch {
    return false;
  }
}

/**
 * ✅ POST /api/admin/properties/:id/approve
 * - Sets status => PUBLISHED
 * - Ensures slug exists
 * - Emails user if we have user relation + email
 *
 * IMPORTANT: Router is mounted at /api/admin
 */
router.post("/properties/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    // load property + user if relation exists
    const includeUser = propertyHasField("userId"); // crude but effective
    const prop = await prisma.property.findUnique({
      where: { id } as any,
      ...(includeUser ? { include: { user: true } } : {}),
    } as any);

    if (!prop) return res.status(404).json({ ok: false, error: "Property not found" });

    const currentStatus = String((prop as any).status || "").toUpperCase();
    if (currentStatus && currentStatus !== "SUBMITTED") {
      return res.status(400).json({ ok: false, error: "Only SUBMITTED listings can be approved" });
    }

    const slugFieldExists = propertyHasField("slug");
    const slug = slugFieldExists
      ? ((prop as any).slug || ensureSlug((prop as any).title || (prop as any).address || id))
      : null;

    const data: any = {};
    if (propertyHasField("status")) data.status = "PUBLISHED";
    if (slugFieldExists && slug) data.slug = slug;

    const updated = await prisma.property.update({
      where: { id } as any,
      data,
    } as any);

    // Email owner (only if relation exists and email present)
    const email = (prop as any)?.user?.email;
    if (email) {
      await sendListingApprovedEmail(email, {
        title: (updated as any).title || (updated as any).address || (updated as any).slug || "Your listing",
        slug: (updated as any).slug || "",
      });
    }

    res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Approve failed" });
  }
});

/**
 * ✅ POST /api/admin/properties/:id/reject
 * - Sets status => REJECTED
 * - Stores rejection reason ONLY if field exists in DB
 * - Emails user with reason
 */
router.post("/properties/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const reason = String(req.body?.reason || "").trim();

    if (!reason) {
      return res.status(400).json({ ok: false, error: "Rejection reason required" });
    }

    const includeUser = propertyHasField("userId");
    const prop = await prisma.property.findUnique({
      where: { id } as any,
      ...(includeUser ? { include: { user: true } } : {}),
    } as any);

    if (!prop) return res.status(404).json({ ok: false, error: "Property not found" });

    const currentStatus = String((prop as any).status || "").toUpperCase();
    if (currentStatus && currentStatus !== "SUBMITTED") {
      return res.status(400).json({ ok: false, error: "Only SUBMITTED listings can be rejected" });
    }

    const data: any = {};
    if (propertyHasField("status")) data.status = "REJECTED";

    // If schema supports a rejection reason field, store it
    if (propertyHasField("rejectedReason")) data.rejectedReason = reason;
    if (propertyHasField("rejectReason")) data.rejectReason = reason;

    const updated = await prisma.property.update({
      where: { id } as any,
      data,
    } as any);

    const email = (prop as any)?.user?.email;
    if (email) {
      const editUrl = `https://havn.ie/property-upload.html?id=${encodeURIComponent((updated as any).id || id)}`;
      await sendListingRejectedEmail(email, {
        title: (updated as any).title || (updated as any).address || (updated as any).slug || "Your listing",
        reason,
        editUrl,
      });
    }

    res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || "Reject failed" });
  }
});

export default router;
