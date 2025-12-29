import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ListingStatus } from "@prisma/client";

// ✅ FIX: requireAuth is a NAMED export in your middleware
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

/**
 * Helpers
 */
function isOwnerOrAdmin(req: any, ownerId: number) {
  const role = req.user?.role;
  const userId = Number(req.user?.id);
  return role === "admin" || userId === ownerId;
}

/**
 * GET /api/properties/mine
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const userId = Number(req.user?.id);
    const role = req.user?.role;

    const where: any = role === "admin" ? {} : { userId };

    const items = await prisma.property.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error("[GET /properties/mine] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties
 * Public browse
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 24), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const skip = (page - 1) * limit;

    const items = await prisma.property.findMany({
      where: {
        listingStatus: ListingStatus.PUBLISHED,
        archivedAt: null,
      },
      orderBy: { publishedAt: "desc" },
      skip,
      take: limit,
    });

    const total = await prisma.property.count({
      where: {
        listingStatus: ListingStatus.PUBLISHED,
        archivedAt: null,
      },
    });

    res.json({ ok: true, page, limit, total, items });
  } catch (e) {
    console.error("[GET /properties] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/properties/:id
 * Public detail (published only)
 */
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    // Public: only published and not archived
    if (prop.listingStatus !== ListingStatus.PUBLISHED || prop.archivedAt) {
      return res.status(404).json({ ok: false, message: "Not found" });
    }

    return res.json({ ok: true, item: prop });
  } catch (e) {
    console.error("[GET /properties/:id] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties
 * Create draft (auth required)
 */
router.post("/", requireAuth, async (req: any, res) => {
  try {
    const userId = Number(req.user?.id);

    const data = req.body || {};
    if (!data.title || !data.slug) {
      return res.status(400).json({ ok: false, message: "Missing required fields" });
    }

    const created = await prisma.property.create({
      data: {
        ...data,
        userId,
        listingStatus: ListingStatus.DRAFT,
      },
    });

    res.json({ ok: true, item: created });
  } catch (e) {
    console.error("[POST /properties] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * POST /api/properties/:id/submit
 * ✅ Updated: blocks unverified users (unless admin)
 */
router.post("/:id/submit", requireAuth, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, message: "Invalid id" });

  try {
    const prop = await prisma.property.findUnique({ where: { id } });
    if (!prop) return res.status(404).json({ ok: false, message: "Not found" });

    if (!isOwnerOrAdmin(req, prop.userId)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    // ✅ EMAIL VERIFIED CHECK (unless admin)
    const role = req.user?.role;
    const currentUserId = Number(req.user?.id);

    if (role !== "admin") {
      const user = await prisma.user.findUnique({
        where: { id: currentUserId },
        select: { emailVerified: true },
      });

      if (!user?.emailVerified) {
        return res.status(403).json({
          ok: false,
          message: "Please verify your email before submitting a property.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }
    }

    if (prop.listingStatus !== ListingStatus.DRAFT && prop.listingStatus !== ListingStatus.REJECTED) {
      return res.status(400).json({ ok: false, message: "Only draft/rejected listings can be submitted." });
    }

    const updated = await prisma.property.update({
      where: { id },
      data: {
        listingStatus: ListingStatus.SUBMITTED,
        submittedAt: new Date(),
        rejectionReason: null,
        rejectedAt: null,
        rejectedById: null,
      },
    });

    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[POST /properties/:id/submit] error:", e);
    res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
