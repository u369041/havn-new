import { Router } from "express";
import prisma from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";

// If you already have these helpers, keep them.
// If not, comment these imports out and the calls below.
import {
  sendListingApprovedEmail,
  sendListingRejectedEmail,
} from "../lib/resendMail";

const router = Router();

function parseId(raw: string) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function makeSlugFallback(p: any) {
  const parts = [
    p?.title || "listing",
    p?.county || "",
    p?.city || "",
    p?.eircode || "",
    String(p?.id || ""),
  ].filter(Boolean);
  return slugify(parts.join(" "));
}

// POST /api/admin/properties/:id/approve
router.post(
  "/properties/:id/approve",
  requireAuth({ role: "admin" }),
  async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ ok: false, message: "Invalid id" });

      const prop = await prisma.property.findUnique({
        where: { id },
        include: { owner: true },
      });

      if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

      if (prop.listingStatus !== "SUBMITTED") {
        return res.status(400).json({
          ok: false,
          message: `Cannot approve from status ${prop.listingStatus}`,
        });
      }

      const slug = prop.slug && prop.slug.trim() ? prop.slug : makeSlugFallback(prop);

      const updated = await prisma.property.update({
        where: { id },
        data: {
          listingStatus: "PUBLISHED",
          publishedAt: new Date(),
          approvedAt: new Date(),
          approvedById: (req as any).user?.id ?? null,
          rejectedAt: null,
          rejectedById: null,
          rejectedReason: null,
          slug,
        },
        include: { owner: true },
      });

      // Best-effort email (don’t fail the approval if email fails)
      try {
        const to = updated.owner?.email;
        if (to) {
          await sendListingApprovedEmail({
            to,
            listingTitle: updated.title || "Your listing",
            liveUrl: `https://havn.ie/property.html?slug=${encodeURIComponent(
              updated.slug || slug
            )}`,
          });
        }
      } catch (e) {
        console.warn("Resend approve email failed:", e);
      }

      return res.json({ ok: true, property: updated });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

// POST /api/admin/properties/:id/reject
router.post(
  "/properties/:id/reject",
  requireAuth({ role: "admin" }),
  async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ ok: false, message: "Invalid id" });

      const reason = String(req.body?.reason || "").trim();
      if (!reason) {
        return res.status(400).json({ ok: false, message: "Reject reason required" });
      }

      const prop = await prisma.property.findUnique({
        where: { id },
        include: { owner: true },
      });

      if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

      if (prop.listingStatus !== "SUBMITTED") {
        return res.status(400).json({
          ok: false,
          message: `Cannot reject from status ${prop.listingStatus}`,
        });
      }

      const updated = await prisma.property.update({
        where: { id },
        data: {
          listingStatus: "REJECTED",
          rejectedAt: new Date(),
          rejectedById: (req as any).user?.id ?? null,
          rejectedReason: reason,
        },
        include: { owner: true },
      });

      // Best-effort email
      try {
        const to = updated.owner?.email;
        if (to) {
          await sendListingRejectedEmail({
            to,
            listingTitle: updated.title || "Your listing",
            reason,
            editUrl: `https://havn.ie/property-upload.html?id=${encodeURIComponent(
              String(updated.id)
            )}`,
          });
        }
      } catch (e) {
        console.warn("Resend reject email failed:", e);
      }

      return res.json({ ok: true, property: updated });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

export default router;
