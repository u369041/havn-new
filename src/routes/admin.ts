// src/routes/admin.ts
import { Router } from "express";
import { requireAdmin } from "../middleware/admin.js";

const r = Router();

// Simple protected ping, use it to verify your ADMIN_KEY works.
r.get("/ping", requireAdmin, (_req, res) => {
  res.json({ ok: true, scope: "admin", ts: new Date().toISOString() });
});

export default r;
