import { Router } from "express";

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

export default router;
