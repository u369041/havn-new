import { Router } from "express";
import prisma from "../prisma";

const router = Router();

router.get("/env", (_req, res) => {
  res.json({
    ok: true,
    hasJWT_SECRET: Boolean(process.env.JWT_SECRET),
    hasADMIN_BOOTSTRAP_TOKEN: Boolean(process.env.ADMIN_BOOTSTRAP_TOKEN),
    nodeEnv: process.env.NODE_ENV || null,
  });
});

router.get("/fingerprint", (_req, res) => {
  res.json({
    ok: true,
    renderGitCommit: process.env.RENDER_GIT_COMMIT || null,
    time: new Date().toISOString(),
  });
});

// ✅ This forces a Prisma DB call and returns the REAL error message
router.get("/db", async (_req, res) => {
  try {
    // Minimal query
    const count = await prisma.user.count();
    res.json({ ok: true, userCount: count });
  } catch (e: any) {
    res.status(500).json({
      ok: false,
      error: e?.message || "DB error",
      code: e?.code || null,
      meta: e?.meta || null,
    });
  }
});

export default router;
