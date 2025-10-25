import { Router } from "express";
const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", timestamp: new Date().toISOString() });
});

router.get("/env", (_req, res) => {
  const raw = process.env.DATABASE_URL || "";
  const host = raw.split("@")[1]?.split("/")[0] || "(unknown)";
  res.json({ ok: true, db_host: host, sslmode: /sslmode=require/i.test(raw) });
});

export default router;