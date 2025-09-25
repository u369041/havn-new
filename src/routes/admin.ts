// src/routes/admin.ts
import { Router } from "express";
import { requireAdmin } from "../middleware/admin.js";

const r = Router();

const SITEMAP_PING_URL = process.env.SITEMAP_PING_URL || "";

// Simple protected ping to verify ADMIN_KEY works.
r.get("/ping", requireAdmin, (_req, res) => {
  res.json({ ok: true, scope: "admin", ts: new Date().toISOString() });
});

// Refresh sitemap cache on Hostinger (fires server-side to avoid exposing the Hostinger key)
r.get("/sitemap/refresh", requireAdmin, async (_req, res) => {
  try {
    if (!SITEMAP_PING_URL) {
      return res.status(500).json({ ok: false, error: "SITEMAP_PING_URL not set" });
    }
    const r = await fetch(SITEMAP_PING_URL).catch(() => null);
    const ok = !!r && r.ok;
    return res.json({ ok, from: "api", pingUrlConfigured: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "internal_error" });
  }
});

export default r;
