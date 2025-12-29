import { Router } from "express";
import requireAdminAuth from "../middleware/adminAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/admin/submitted
 * Admin-only: returns submitted listings.
 */
router.get("/submitted", requireAdminAuth, async (req, res) => {
  try {
    const items = await prisma.property.findMany({
      where: { listingStatus: "SUBMITTED" },
      orderBy: { submittedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /admin/submitted error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
