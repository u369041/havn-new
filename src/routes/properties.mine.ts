import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/properties/mine
 * Returns properties belonging to the logged-in user.
 */
router.get("/mine", requireAuth, async (req: any, res) => {
  try {
    const userId = req.user.userId;

    const items = await prisma.property.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    console.error("GET /properties/mine error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

export default router;
