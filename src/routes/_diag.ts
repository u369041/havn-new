import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * GET /api/_diag/env
 * Proves env vars are present (without leaking secrets)
 */
router.get("/env", (_req, res) => {
  res.json({
    hasJWT_SECRET: Boolean(process.env.JWT_SECRET),
    hasADMIN_BOOTSTRAP_TOKEN: Boolean(process.env.ADMIN_BOOTSTRAP_TOKEN),
    nodeEnv: process.env.NODE_ENV || "unknown",
  });
});

/**
 * GET /api/_diag/fingerprint
 * Proves which commit/build is deployed
 */
router.get("/fingerprint", (_req, res) => {
  res.json({
    ok: true,
    commit: process.env.RENDER_GIT_COMMIT || process.env.COMMIT_SHA || "unknown",
    service: process.env.RENDER_SERVICE_NAME || "unknown",
    nodeEnv: process.env.NODE_ENV || "unknown",
    ts: new Date().toISOString(),
  });
});

/**
 * GET /api/_diag/db
 * Proves Prisma can connect and run a trivial query.
 * If it fails, returns a structured error (no secrets).
 */
router.get("/db", async (_req, res) => {
  try {
    // Lightweight connectivity check:
    // For Postgres, SELECT 1 is safe and fast.
    const result = await prisma.$queryRawUnsafe("SELECT 1 as ok");
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      name: err?.name || "Error",
      message: err?.message || "DB error",
      code: err?.code || null,
    });
  }
});

export default router;
