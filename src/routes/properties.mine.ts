// src/routes/properties.mine.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ListingStatus } from "@prisma/client";
import { requireAuth } from "../middleware/auth";

const router = Router();

function getUser(req: Request): { id: number; role?: string } | null {
  return ((req as any).user as any) || null;
}

function isOwnerOrAdmin(req: Request, userId: number | null): boolean {
  const u = getUser(req);
  if (!u) return false;
  if (u.role === "admin") return true;
  return userId != null && u.id === userId;
}

/**
 * GET /api/properties/mine
 */
router.get("/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = getUser(req)!;

    const items = await prisma.property.findMany({
      where: { userId: user.id },
      orderBy: [{ updatedAt: "desc" }],
    });

    return res.json({ ok: true, items });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Failed" });
  }
});

/**
 * ✅ CRITICAL FIX
 * POST /api/properties/:slug/archive
 * This MUST exist here because this router is mounted first.
 */
router.post("/:slug/archive", requireAuth, async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, message: "Missing slug" });

    const existing = await prisma.property.findUnique({ where: { slug } });
    if (!existing) return res.status(404).json({ ok: false, message: "Property not found" });

    if (!isOwnerOrAdmin(req, existing.userId ?? null)) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    if (existing.listingStatus === ListingStatus.ARCHIVED) {
      return res.status(409).json({ ok: false, message: "Already archived" });
    }

    const updated = await prisma.property.update({
      where: { id: existing.id },
      data: {
        listingStatus: ListingStatus.ARCHIVED,
        archivedAt: new Date(),
        publishedAt: null,
        submittedAt: null,
      },
    });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    return res.status(500).json({ ok: false, message: err?.message || "Archive failed" });
  }
});

export default router;
