import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

type ListingStatus = "DRAFT" | "SUBMITTED" | "PUBLISHED" | "REJECTED" | "CLOSED" | "ARCHIVED";
type CloseOutcome = "SOLD" | "RENTED" | "CANCELLED" | "OTHER";

function normalizePayload(body: any) {
  if (!body) return {};

  if (typeof body === "string") {
    const s = body.trim();
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  }

  if (typeof body === "object") return body;
  return {};
}

function normStatus(raw: any): ListingStatus | "" {
  const s = safeText(raw).trim().toUpperCase();

  if (s === "DRAFT") return "DRAFT";
  if (s === "SUBMITTED" || s === "PENDING") return "SUBMITTED";
  if (s === "PUBLISHED" || s === "LIVE" || s === "APPROVED") return "PUBLISHED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "CLOSED") return "CLOSED";
  if (s === "ARCHIVED") return "ARCHIVED";

  return "";
}

function normOutcome(raw: any): CloseOutcome | "" {
  const s = safeText(raw).trim().toUpperCase();
  if (s === "SOLD" || s === "RENTED" || s === "CANCELLED" || s === "OTHER") return s;
  return "";
}

function parseFeatureDays(raw: any): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 7;
  return Math.min(Math.max(Math.round(n), 1), 365);
}

function asOptionalDate(raw: any): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function getUserEmailById(userId: number): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email || null;
  } catch {
    return null;
  }
}

function requireAdmin(user: any, res: any) {
  if (!user || user.role !== "admin") {
    res.status(403).json({ ok: false, message: "Forbidden" });
    return false;
  }
  return true;
}

/**
 * GET /api/admin/properties
 */
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const items = await prisma.property.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /api/admin/properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * PATCH /api/admin/properties/:id
 * Admin-only: saves moderation status/admin note from dashboard.
 */
router.patch("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const payload = normalizePayload(req.body);
    const nextStatus = normStatus(payload.listingStatus);
    const adminNote = safeText(payload.adminNote || payload.reason).trim();

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    const data: any = {};

    if (nextStatus) {
      data.listingStatus = nextStatus;

      if (nextStatus === "PUBLISHED") {
        data.publishedAt = existing.publishedAt || new Date();
        data.approvedAt = new Date();
        data.approvedById = user.userId;
        data.rejectedAt = null;
        data.rejectedById = null;
        data.rejectedReason = null;
      }

      if (nextStatus === "REJECTED") {
        data.rejectedAt = new Date();
        data.rejectedById = user.userId;
        data.rejectedReason = adminNote || existing.rejectedReason || null;
      }

      if (nextStatus === "CLOSED" || nextStatus === "ARCHIVED") {
        data.archivedAt = existing.archivedAt || new Date();
        data.isFeatured = false;
        data.featuredUntil = null;
      }
    }

    if (payload.adminNote !== undefined || payload.reason !== undefined) {
      data.rejectedReason = adminNote || null;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ ok: false, message: "No valid fields to update" });
    }

    const updated = await prisma.property.update({
      where: { id },
      data,
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("PATCH /api/admin/properties/:id error", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/admin/properties/:id/approve
 * Admin-only: moves SUBMITTED listing to PUBLISHED.
 */
router.post("/:id/approve", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Only SUBMITTED listings can be approved. Current status: ${existing.listingStatus}`,
      });
    }

    const now = new Date();

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: existing.publishedAt || now,
        approvedAt: now,
        approvedById: user.userId,
        rejectedAt: null,
        rejectedById: null,
        rejectedReason: null,
      },
    });

    void (async () => {
      try {
        const to = await getUserEmailById(updated.userId);
        if (!to) return;

        await sendUserListingEmail({
          to,
          event: "APPROVED",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
        } as any);
      } catch (e) {
        console.warn("Approve email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/approve error", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/admin/properties/:id/reject
 * Admin-only: moves SUBMITTED listing to REJECTED.
 */
router.post("/:id/reject", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const payload = normalizePayload(req.body);
    const reason = safeText(payload.reason || payload.adminNote).trim() || null;

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "SUBMITTED") {
      return res.status(409).json({
        ok: false,
        message: `Only SUBMITTED listings can be rejected. Current status: ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectedById: user.userId,
        rejectedReason: reason,
        isFeatured: false,
        featuredUntil: null,
      },
    });

    void (async () => {
      try {
        const to = await getUserEmailById(updated.userId);
        if (!to) return;

        await sendUserListingEmail({
          to,
          event: "REJECTED",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
          reason: reason || undefined,
        } as any);
      } catch (e) {
        console.warn("Reject email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/reject error", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/admin/properties/:id/feature
 * Admin-only: marks a published listing as featured.
 */
router.post("/:id/feature", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const payload = normalizePayload(req.body);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Only PUBLISHED listings can be featured. Current status: ${existing.listingStatus}`,
      });
    }

    const explicitDate = asOptionalDate(payload.featuredUntil);
    const days = parseFeatureDays(payload.days ?? payload.durationDays ?? 7);
    const featuredUntil = explicitDate || new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: true,
        featuredUntil,
      },
    });

    return res.json({ ok: true, item: updated, featuredUntil, days });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/feature error", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/admin/properties/:id/unfeature
 * Admin-only: removes featured status.
 */
router.post("/:id/unfeature", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, message: "Invalid id" });
    }

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    const updated = await prisma.property.update({
      where: { id },
      data: {
        isFeatured: false,
        featuredUntil: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/unfeature error", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

/**
 * POST /api/admin/properties/:id/reopen
 */
router.post("/:id/reopen", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "CLOSED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot reopen listing from status ${existing.listingStatus}`,
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "PUBLISHED",
        publishedAt: existing.publishedAt || new Date(),
        archivedAt: null,
        marketStatus: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/reopen error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/close
 */
router.post("/:id/close", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Invalid id" });

    const payload = normalizePayload(req.body);

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot close listing from status ${existing.listingStatus}`,
      });
    }

    const outcome = normOutcome(payload.outcome);
    if (!outcome) {
      return res.status(400).json({
        ok: false,
        message: "Invalid outcome. Allowed: SOLD, RENTED, CANCELLED, OTHER",
      });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(),
        marketStatus: outcome,
        isFeatured: false,
        featuredUntil: null,
      },
    });

    void (async () => {
      try {
        const to = await getUserEmailById(updated.userId);
        if (!to) return;

        await sendUserListingEmail({
          to,
          event: "CLOSED",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
          closeOutcome: outcome,
        } as any);
      } catch (e) {
        console.warn("Close email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated, outcome });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/close error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;