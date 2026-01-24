import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";
import { sendUserListingEmail } from "../lib/mail";

const router = Router();

function safeText(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function normOutcome(raw: any): "SOLD" | "RENTED" | "CANCELLED" | "OTHER" | "" {
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
 * Simple admin list (optional; your admin.html primarily hits /api/properties/_admin)
 */
router.get("/", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

    const items = await prisma.property.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /api/admin/properties error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/admin/properties/:id/close
 * Close = archive listing (DB uses ARCHIVED per schema)
 * Body: { outcome?: "SOLD"|"RENTED"|"CANCELLED"|"OTHER" }
 */
router.post("/:id/close", requireAuth, async (req: any, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") return res.status(403).json({ ok: false, message: "Forbidden" });

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

    const existing = await prisma.property.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ ok: false, message: "Not found" });

    // Only allow close from PUBLISHED (your call; this is safest)
    if (existing.listingStatus !== "PUBLISHED") {
      return res.status(409).json({
        ok: false,
        message: `Cannot close listing from status ${existing.listingStatus}`,
      });
    }

    const outcome = normOutcome(req.body?.outcome);

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: "ARCHIVED",
        archivedAt: new Date(),
      },
    });

    // Email customer (fire-and-forget; never breaks flow)
    void (async () => {
      try {
        const to = await getUserEmailById(updated.userId);
        if (!to) return;

        // If you later add a dedicated "closeOutcome" column, we’ll store it too.
        // For now we include it in the email (metrics can come later with schema change).
        await sendUserListingEmail({
          to,
          event: "CLOSED", // keep your email templates consistent; you can map this server-side
          listingTitle: updated.title || "Untitled listing",
          slug: updated.slug,
          listingId: updated.id,
          myListingsUrl: "https://havn.ie/my-listings.html",
          // Optional extra info for template usage (safe if template ignores unknown fields)
          outcome: outcome || undefined,
        } as any);
      } catch (e) {
        console.warn("Close email failed (non-fatal):", e);
      }
    })();

    return res.json({ ok: true, item: updated, outcome: outcome || null });
  } catch (err: any) {
    console.error("POST /api/admin/properties/:id/close error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
