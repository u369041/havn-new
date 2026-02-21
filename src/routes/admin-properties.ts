﻿import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

type CloseOutcome = "SOLD" | "RENTED" | "CANCELLED" | "OTHER";

function normOutcome(raw: any): CloseOutcome | "" {
  const s = safeText(raw).trim().toUpperCase();
  if (s === "SOLD" || s === "RENTED" || s === "CANCELLED" || s === "OTHER") return s;
  return "";
}

async function getUserEmailById(userId: number): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/properties
 * (Optional; admin.html may use /api/properties/_admin)
 */
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

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
 * POST /api/admin/properties/:id/reopen
 * Admin-only: CLOSED -> PUBLISHED
 * Resets:
 *   archivedAt = null
 *   marketStatus = null
 * Ensures:
 *   publishedAt exists (keeps existing if present, otherwise sets now)
 */
router.post("/:id/reopen", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

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
 * Canonical close:
 *   listingStatus = "CLOSED"
 *   archivedAt    = new Date()
 *   marketStatus  = outcome ("SOLD"|"RENTED"|"CANCELLED"|"OTHER")
 *
 * IMPORTANT:
 * - Do NOT reference closedAt / closeOutcome / closeOutcomeNote (do not exist)
 */
router.post("/:id/close", requireAuth, async (req: any, res: any) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    // safest rule: only close from PUBLISHED
    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot close listing from status ${existing.listingStatus}`,
      });
    }

    const outcome = normOutcome(req.body?.outcome);
    if (!outcome) {
      return res.status(400).json({
        ok: false,
        message: "Invalid outcome. Allowed: SOLD, RENTED, CANCELLED, OTHER",
      });
    }

    // ✅ Force archivedAt on close (correctness first)
    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(),
        marketStatus: outcome,
      },
    });

    // Email customer (non-fatal)
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