import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/_diag/fingerprint
 * Returns a lightweight build fingerprint so we can confirm which deploy is live.
 */
router.get("/fingerprint", async (req, res) => {
  try {
    const fingerprint =
      process.env.RENDER_GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      "unknown";

    return res.json({
      ok: true,
      fingerprint,
      node: process.version,
      env: process.env.NODE_ENV || "unknown",
      time: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("GET /_diag/fingerprint error", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * GET /api/_diag/db
 * Confirms database connectivity with a SELECT 1.
 */
router.get("/db", async (req, res) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("GET /_diag/db error", err);
    return res.status(500).json({
      ok: false,
      message: "DB error",
      error: err?.message || String(err),
    });
  }
});

export default router;
