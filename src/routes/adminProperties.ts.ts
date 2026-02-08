// src/routes/adminProperties.ts
import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function isAdmin(user: any) {
  return user && user.role === "admin";
}

/**
 * Close outcomes (we store this in `marketStatus` for now)
 * because your Prisma schema does NOT have closedAt/closeOutcome/closeOutcomeNote.
 */
type CloseOutcome = "SOLD" | "RENTED" | "CANCELLED" | "OTHER";

function clampOutcome(raw: any): CloseOutcome | null {
  const v = safeText(raw).trim().toUpperCase();
  if (!v) return null;
  if (v === "SOLD" || v === "RENTED" || v === "CANCELLED" || v === "OTHER") return v as CloseOutcome;
  return null;
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
 * POST /api/admin/properties/:id/close
 * Admin-only: PUBLISHED -> CLOSED
 *
 * Body: { outcome?: "SOLD"|"RENTED"|"CANCELLED"|"OTHER", note?: string }
 *
 * ✅ DB writes:
 * - listingStatus = "CLOSED"
 * - archivedAt = now()        (we’re using this as closed timestamp)
 * - marketStatus = outcome    (optional)
 *
 * ❌ We do NOT write closedAt / closeOutcome / closeOutcomeNote (they don't exist in schema)
 */
router.post("/:id/close", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    if (!isAdmin(user)) return res.status(403).json({ ok: false, message: "Forbidden" });

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Only PUBLISHED listings can be closed (current: ${existing.listingStatus})`,
      });
    }

    const outcome = clampOutcome(req.body?.outcome);
    const note = safeText(req.body?.note).trim(); // kept for future use, not stored
    if (note) {
      console.info("Close note (not stored - no schema field):", { id, note });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "CLOSED",
        archivedAt: new Date(),
        // Use marketStatus as a lightweight outcome marker (optional)
        ...(outcome ? { marketStatus: outcome } : {}),
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
          // optional metadata (template may ignore)
          outcome: outcome || undefined,
        } as any);
      } catch (e) {
        console.warn("Close email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated, outcome: outcome || null });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/close error", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
});

export default router;
