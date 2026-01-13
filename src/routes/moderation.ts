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

function inferCloseOutcome(p: any): "SOLD" | "RENTED" {
  const saleType = String(p?.saleType || "").toLowerCase();
  if (saleType.includes("rent") || saleType.includes("lease") || saleType.includes("share")) return "RENTED";
  return "SOLD";
}

/**
 * POST /api/admin/properties/:id/approve
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
      return res.status(409).json({ ok: false, message: `Cannot approve from status ${existing.listingStatus}` });
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
      return res.status(409).json({ ok: false, message: `Cannot reject from status ${existing.listingStatus}` });
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
 * ✅ NEW: POST /api/admin/properties/:id/close
 * Marks a listing as ARCHIVED (closed) and emails the customer.
 * Optional body: { outcome?: "SOLD" | "RENTED" }
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
      return res.status(409).json({ ok: false, message: `Can only close PUBLISHED listings (current: ${existing.listingStatus})` });
    }

    const requestedOutcome = String(req.body?.outcome || "").toUpperCase();
    const inferred = inferCloseOutcome(existing);
    const outcome: "SOLD" | "RENTED" =
      requestedOutcome === "SOLD" ? "SOLD" : requestedOutcome === "RENTED" ? "RENTED" : inferred;

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "ARCHIVED",
        archivedAt: new Date(),
        marketStatus: outcome, // keeps a useful marker even after archive
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
