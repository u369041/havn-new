// src/routes/moderation.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth"; // default import
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin only" });
  }
  next();
}

/**
 * Close outcomes (reason) are stored in marketStatus for now (per your existing schema),
 * while listingStatus becomes CLOSED.
 *
 * This gives you:
 * - listingStatus = CLOSED  (state)
 * - marketStatus  = SOLD | RENTED | CANCELLED | OTHER  (reason)
 */
type CloseOutcome = "SOLD" | "RENTED" | "CANCELLED" | "OTHER";

function inferCloseOutcome(p: any): CloseOutcome {
  const saleType = String(p?.saleType || "").toLowerCase();
  const mode = String(p?.mode || "").toUpperCase();

  // If it's clearly rent/share oriented, assume RENTED
  if (saleType.includes("rent") || saleType.includes("lease") || saleType.includes("share")) return "RENTED";
  if (mode === "RENT" || mode === "SHARE") return "RENTED";

  // Default assumption for BUY
  return "SOLD";
}

function normalizeOutcome(raw: any, fallback: CloseOutcome): CloseOutcome {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "SOLD" || s === "RENTED" || s === "CANCELLED" || s === "OTHER") return s;
  return fallback;
}

/**
 * POST /api/admin/properties/:id/approve
 * Approves SUBMITTED -> PUBLISHED
 */
router.post("/properties/:id/approve", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res
        .status(409)
        .json({ ok: false, message: `Cannot approve from status ${existing.listingStatus}` });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: new Date(),
        approvedAt: new Date(),
        approvedById: req.user.userId,
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
        // When publishing, clear any prior close/archive markers
        archivedAt: null,
        marketStatus: existing.marketStatus, // leave as-is (often null)
      },
      include: { user: true },
    });

    // Customer email: approved/live
    void sendUserListingEmail({
      to: updated.user.email,
      event: "APPROVED_LIVE",
      listingTitle: updated.title,
      slug: updated.slug,
      listingId: updated.id,
      publicUrl: `https://havn.ie/property.html?slug=${updated.slug}`,
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("approve error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 * Body: { reason?: string }
 * Rejects SUBMITTED -> REJECTED
 */
router.post("/properties/:id/reject", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const reason = String(req.body?.reason || "").trim();

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res
        .status(409)
        .json({ ok: false, message: `Cannot reject from status ${existing.listingStatus}` });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: req.user.userId,
        rejectedReason: reason || null,

        approvedAt: null,
        approvedById: null,
        publishedAt: null,

        // Reject is not "closed"
        archivedAt: null,
      },
      include: { user: true },
    });

    // Customer email: rejected
    void sendUserListingEmail({
      to: updated.user.email,
      event: "REJECTED",
      listingTitle: updated.title,
      slug: updated.slug,
      listingId: updated.id,
      reason: reason || updated.rejectedReason || "",
      myListingsUrl: "https://havn.ie/my-listings.html",
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("reject error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

/**
 * ✅ POST /api/admin/properties/:id/close
 *
 * PUBLISHED -> CLOSED
 * Body: { outcome?: "SOLD" | "RENTED" | "CANCELLED" | "OTHER" }
 *
 * - listingStatus becomes CLOSED (your requested state)
 * - archivedAt is set (timestamp of close; we keep the field name for compatibility)
 * - marketStatus stores the outcome reason for future metrics
 */
router.post("/properties/:id/close", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    // Only close live listings
    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Can only close PUBLISHED listings (current: ${existing.listingStatus})`,
      });
    }

    const inferred = inferCloseOutcome(existing);
    const outcome: CloseOutcome = normalizeOutcome(req.body?.outcome, inferred);

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(), // we reuse archivedAt as the closed timestamp for now
        marketStatus: outcome,  // SOLD | RENTED | CANCELLED | OTHER
      },
      include: { user: true },
    });

    // Customer email: closed
    void sendUserListingEmail({
      to: updated.user.email,
      event: "CLOSED",
      listingTitle: updated.title,
      slug: updated.slug,
      listingId: updated.id,
      closeOutcome: outcome,
      myListingsUrl: "https://havn.ie/my-listings.html",
    });

    return res.json({ ok: true, item: updated, outcome });
  } catch (err: any) {
    console.error("close error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

export default router;
