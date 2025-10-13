import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

/** GET /api/listings */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, listingType, q } = req.query as Record<string, string | undefined>;
    const take = Math.min(Math.max(parseInt((req.query.limit as string) ?? "50", 10) || 50, 1), 200);

    const where: any = {};
    if (status) where.status = String(status);
    if (listingType) where.listingType = String(listingType);
    if (q) {
      const term = String(q);
      where.OR = [
        { title:   { contains: term, mode: "insensitive" } },
        { address: { contains: term, mode: "insensitive" } },
        { eircode: { contains: term.replace(/\s+/g, ""), mode: "insensitive" } }
      ];
    }

    const rows = await prisma.property.findMany({
      where,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, title: true, status: true, listingType: true,
        price: true, address: true, eircode: true, images: true, createdAt: true
      }
    });

    return res.json({ ok: true, count: rows.length, listings: rows });
  } catch (err: any) {
    console.error("[listings] list error:", err);
    const debug = String(req.query.debug || "") === "1";
    return res
      .status(500)
      .json(debug ? { ok: false, error: "server-error", detail: String(err) }
                  : { ok: false, error: "server-error" });
  }
});

/** GET /api/listings/:slug */
router.get("/:slug", async (req: Request, res: Response) => {
  try {
    const p = await prisma.property.findUnique({ where: { slug: req.params.slug } });
    if (!p) return res.status(404).json({ ok: false, error: "not-found" });
    return res.json({ ok: true, listing: p });
  } catch (err: any) {
    console.error("[listings] get error:", err);
    const debug = String(req.query.debug || "") === "1";
    return res
      .status(500)
      .json(debug ? { ok: false, error: "server-error", detail: String(err) }
                  : { ok: false, error: "server-error" });
  }
});

export default router;
