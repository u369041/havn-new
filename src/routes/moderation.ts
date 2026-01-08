import { Router } from "express";
import { prisma } from "../lib/prisma";
import requireAuth from "../middleware/requireAuth";

let sendListingApprovedEmail: any = null;
let sendListingRejectedEmail: any = null;

// Optional email wiring (won’t break build if missing)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mail = require("../lib/resendMail");
  sendListingApprovedEmail = mail.sendListingApprovedEmail;
  sendListingRejectedEmail = mail.sendListingRejectedEmail;
} catch {
  console.warn("Resend mail not available – continuing without emails");
}

const router = Router();

function parseId(raw: string) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
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
  return slugify(
    [
      p?.title || "listing",
      p?.county || "",
      p?.city || "",
      p?.eircode || "",
      p?.id,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * POST /api/admin/properties/:id/approve
 */
router.post(
  "/properties/:id/approve",
  requireAuth({ role: "admin" }),
  async (req, res) => {
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
        message: `Cannot approve from ${prop.listingStatus}`,
      });
    }

    const slug = prop.slug || makeSlugFallback(prop);

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
    });

    if (sendListingApprovedEmail && prop.owner?.email) {
      try {
        await sendListingApprovedEmail({
          to: prop.owner.email,
          listingTitle: prop.title || "Your listing",
          liveUrl: `https://havn.ie/property.html?slug=${encodeURIComponent(
            slug
          )}`,
        });
      } catch {
        /* ignore email failure */
      }
    }

    res.json({ ok: true, property: updated });
  }
);

/**
 * POST /api/admin/properties/:id/reject
 */
router.post(
  "/properties/:id/reject",
  requireAuth({ role: "admin" }),
  async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid id" });

    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res
        .status(400)
        .json({ ok: false, message: "Reject reason required" });
    }

    const prop = await prisma.property.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (prop.listingStatus !== "SUBMITTED") {
      return res.status(400).json({
        ok: false,
        message: `Cannot reject from ${prop.listingStatus}`,
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
    });

    if (sendListingRejectedEmail && prop.owner?.email) {
      try {
        await sendListingRejectedEmail({
          to: prop.owner.email,
          listingTitle: prop.title || "Your listing",
          reason,
          editUrl: `https://havn.ie/property-upload.html?id=${id}`,
        });
      } catch {
        /* ignore email failure */
      }
    }

    res.json({ ok: true, property: updated });
  }
);

export default router;
