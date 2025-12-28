import express from "express";
import prisma from "../prisma";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/adminAuth";
import { ListingStatus } from "@prisma/client";

const router = express.Router();

/**
 * GET /api/admin/pending
 * Returns all submitted listings for moderation.
 */
router.get("/pending", requireAuth, requireAdmin, async (req, res) => {
  const items = await prisma.property.findMany({
    where: { listingStatus: ListingStatus.SUBMITTED },
    orderBy: { submittedAt: "desc" },
  });

  res.json({ ok: true, items });
});

/**
 * GET /api/admin/stats
 * Quick counts for moderation dashboard.
 */
router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  const [draft, submitted, published, rejected, archived] = await Promise.all([
    prisma.property.count({ where: { listingStatus: ListingStatus.DRAFT } }),
    prisma.property.count({ where: { listingStatus: ListingStatus.SUBMITTED } }),
    prisma.property.count({ where: { listingStatus: ListingStatus.PUBLISHED } }),
    prisma.property.count({ where: { listingStatus: ListingStatus.REJECTED } }),
    prisma.property.count({ where: { listingStatus: ListingStatus.ARCHIVED } }),
  ]);

  res.json({
    ok: true,
    counts: { draft, submitted, published, rejected, archived },
  });
});

export default router;
