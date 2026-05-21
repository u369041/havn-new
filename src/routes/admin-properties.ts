import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail, sendSavedSearchMatchEmail } from "../lib/mail";

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

function normText(v: any) {
  return String(v || "").trim().toLowerCase();
}

function propertyLocation(p: any) {
  const city = safeText(p.city).trim();
  const county = safeText(p.county).trim();
  if (city && county) return `${city}, ${county}`;
  return city || county || "";
}

function berMatches(filter: any, property: any) {
  const band = safeText(filter).trim().toLowerCase();
  if (!band) return true;

  const ber = safeText(property.berRating || property.ber).trim().toUpperCase();

  if (band === "a-b") return ["A1", "A2", "A3", "B1", "B2", "B3"].includes(ber);
  if (band === "c-d") return ["C1", "C2", "C3", "D1", "D2"].includes(ber);
  if (band === "e-g") return ["E1", "E2", "F", "G"].includes(ber);

  return true;
}

function yesNoMatches(filter: any, value: any) {
  const f = normText(filter);
  if (!f) return true;

  const v = normText(value);

  if (f === "yes") return v === "yes" || v === "true" || value === true;
  if (f === "no") return !(v === "yes" || v === "true" || value === true);

  return true;
}

function priceBandMatches(filter: any, property: any) {
  const band = safeText(filter).trim().toLowerCase();
  if (!band) return true;

  const price = Number(property.price);
  if (!Number.isFinite(price)) return false;

  if (band === "under-300k") return price < 300000;
  if (band === "300-500k") return price >= 300000 && price <= 500000;
  if (band === "500-800k") return price >= 500000 && price <= 800000;
  if (band === "800k-plus") return price >= 800000;

  if (band === "under-1500") return price < 1500;
  if (band === "1500-2500") return price >= 1500 && price <= 2500;
  if (band === "2500-3500") return price >= 2500 && price <= 3500;
  if (band === "3500-plus") return price >= 3500;

  if (band === "under-700") return price < 700;
  if (band === "700-1000") return price >= 700 && price <= 1000;
  if (band === "1000-1500") return price >= 1000 && price <= 1500;
  if (band === "1500-plus") return price >= 1500;

  return true;
}

function roomTypeMatches(filter: any, property: any) {
  const wanted = safeText(filter).trim().toLowerCase();
  if (!wanted) return true;

  const roomType = normText(property.roomType);
  const hay = [
    property.title,
    property.description,
    property.propertyType,
    property.roomType,
  ].map(normText).join(" ");

  if (wanted === "single-room") return roomType.includes("single") || hay.includes("single room");
  if (wanted === "double-room") return roomType.includes("double") || hay.includes("double room");
  if (wanted === "studio") return roomType.includes("studio") || hay.includes("studio");

  return true;
}

function savedSearchMatchesProperty(filters: any, property: any) {
  if (!filters || typeof filters !== "object") return false;

  const wantedMode = safeText(filters.mode).trim().toUpperCase();
  if (wantedMode && wantedMode !== safeText(property.mode).trim().toUpperCase()) return false;

  const q = normText(filters.q);
  if (q) {
    const hay = [
      property.title,
      property.address1,
      property.address2,
      property.city,
      property.county,
      property.eircode,
      property.description,
    ].map(normText).join(" ");

    if (!hay.includes(q)) return false;
  }

  if (!priceBandMatches(filters.price, property)) return false;

  const beds = Number(filters.beds);
  if (Number.isFinite(beds) && beds > 0) {
    const actualBeds = Number(property.bedrooms);
    if (!Number.isFinite(actualBeds) || actualBeds < beds) return false;
  }

  const baths = Number(filters.baths);
  if (Number.isFinite(baths) && baths > 0) {
    const actualBaths = Number(property.bathrooms);
    if (!Number.isFinite(actualBaths) || actualBaths < baths) return false;
  }

  const type = safeText(filters.type).trim().toUpperCase();
  if (type && safeText(property.propertyType).trim().toUpperCase() !== type) return false;

  if (!roomTypeMatches(filters.roomType, property)) return false;
  if (!berMatches(filters.berBand, property)) return false;
  if (!yesNoMatches(filters.furnished, property.furnished)) return false;
  if (!yesNoMatches(filters.ensuite, property.ensuite)) return false;
  if (!yesNoMatches(filters.couplesAllowed, property.couplesAllowed)) return false;
  if (!yesNoMatches(filters.billsIncluded, property.billsIncluded)) return false;

  return true;
}

async function notifyMatchingSavedSearches(property: any) {
  try {
    const savedSearches = await prisma.savedSearch.findMany({
      where: {
        userId: { not: property.userId },
        alertsEnabled: true,
      },
      include: {
        user: {
          select: {
            email: true,
          },
        },
      },
      take: 500,
    });

    const propertyUrl = `https://havn.ie/property.html?slug=${encodeURIComponent(property.slug)}`;

    for (const saved of savedSearches) {
      const filters: any = saved.filters || {};

      if (!saved.user?.email) continue;
      if (!savedSearchMatchesProperty(filters, property)) continue;

      await sendSavedSearchMatchEmail({
        to: saved.user.email,
        propertyTitle: property.title || "New HAVN property",
        propertyPrice: property.price,
        propertyLocation: propertyLocation(property),
        propertyUrl,
        mode: property.mode,
      });
    }
  } catch (err) {
    console.warn("Saved-search alert matching failed (non-fatal):", err);
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

    if (updated.listingStatus === "PUBLISHED") {
      void notifyMatchingSavedSearches(updated);
    }

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
          event: "APPROVED_LIVE",
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          publicUrl: `https://havn.ie/property.html?slug=${encodeURIComponent(updated.slug)}`,
          myListingsUrl: "https://havn.ie/my-listings.html",
        } as any);
      } catch (e) {
        console.warn("Approve email failed (non-fatal):", e);
      }
    })();

    void notifyMatchingSavedSearches(updated);

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

    void notifyMatchingSavedSearches(updated);

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

/**
 * DELETE /api/admin/properties/:id
 */
router.delete("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!requireAdmin(user, res)) return;

    const id = parseInt(String(req.params.id), 10);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid id",
      });
    }

    const existing = await prisma.property.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        ok: false,
        message: "Property not found",
      });
    }

    await prisma.property.delete({
      where: { id },
    });

    return res.json({
      ok: true,
      deletedId: id,
    });

  } catch (err: any) {
    console.error("DELETE /api/admin/properties/:id error", err);

    return res.status(500).json({
      ok: false,
      message: "Server error",
      error: err?.message || String(err),
    });
  }
});

export default router;