// src/routes/moderation.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

type ListingStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "PUBLISHED"
  | "REJECTED"
  | "CLOSED"
  | "ARCHIVED";

function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ ok: false, message: "Admin only" });
  }
  next();
}

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function asListingStatus(raw: any): ListingStatus | null {
  const s = safeText(raw).trim().toUpperCase();

  if (s === "PENDING") return "SUBMITTED";

  if (
    s === "DRAFT" ||
    s === "SUBMITTED" ||
    s === "PUBLISHED" ||
    s === "REJECTED" ||
    s === "CLOSED" ||
    s === "ARCHIVED"
  ) {
    return s;
  }

  return null;
}

function buildModerationData(existing: any, nextStatus: ListingStatus, adminUserId: number, reason: string) {
  const now = new Date();

  const base: any = {
    listingStatus: nextStatus,
  };

  if (nextStatus === "DRAFT") {
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "SUBMITTED") {
    base.submittedAt = existing.submittedAt || now;
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "PUBLISHED") {
    base.publishedAt = existing.publishedAt || now;
    base.approvedAt = now;
    base.approvedById = adminUserId;
    base.rejectedAt = null;
    base.rejectedById = null;
    base.rejectedReason = null;
  }

  if (nextStatus === "REJECTED") {
    base.rejectedAt = now;
    base.rejectedById = adminUserId;
    base.rejectedReason = reason || existing.rejectedReason || null;
    base.publishedAt = null;
    base.approvedAt = null;
    base.approvedById = null;
  }

  if (nextStatus === "CLOSED" || nextStatus === "ARCHIVED") {
    base.publishedAt = nextStatus === "ARCHIVED" ? null : existing.publishedAt;
  }

  return base;
}

/**
 * NEW:
 * PATCH /api/admin/properties/:id
 * Body:
 * {
 *   listingStatus: "DRAFT"|"SUBMITTED"|"PUBLISHED"|"REJECTED"|"CLOSED"|"ARCHIVED",
 *   reason?: string
 * }
 */
router.patch("/properties/:id", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const nextStatus = asListingStatus(req.body?.listingStatus ?? req.body?.status);
    const reason = safeText(req.body?.reason).trim();

    if (!nextStatus) {
      return res.status(400).json({ ok: false, message: "Invalid listingStatus" });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: buildModerationData(existing, nextStatus, req.user.userId, reason),
      include: { user: true },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("admin generic status update error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/approve
 * SUBMITTED -> PUBLISHED
 */
router.post("/properties/:id/approve", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot approve from status ${existing.listingStatus}`,
      });
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

    void (async () => {
      try {
        await sendUserListingEmail({
          to: updated.user.email,
          event: "APPROVED_LIVE",
          listingTitle: updated.title,
          slug: updated.slug,
          listingId: updated.id,
          publicUrl: `https://havn.ie/property.html?slug=${updated.slug}`,
        } as any);
      } catch (e) {
        console.warn("Approve email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("approve error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 * Body: { reason?: string }
 * SUBMITTED -> REJECTED
 */
router.post("/properties/:id/reject", requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const reason = safeText(req.body?.reason).trim();

    const existing = await prisma.property.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot reject from status ${existing.listingStatus}`,
      });
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

    void (async () => {
      try {
        await sendUserListingEmail({
          to: updated.user.email,
          event: "REJECTED",
          listingTitle: updated.title,
          slug: updated.slug,
          listingId: updated.id,
          reason: reason || updated.rejectedReason || "",
          myListingsUrl: "https://havn.ie/my-listings.html",
        } as any);
      } catch (e) {
        console.warn("Reject email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("reject error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

export default router;