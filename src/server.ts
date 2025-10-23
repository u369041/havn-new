// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { properties } from "./routes/properties.js";
import { listings } from "./routes/listings.js";
import { debug } from "./routes/debug.js";

/**
 * Some local typing narrowed `process` to `{ env: ProcessEnv }`.
 * Use the real NodeJS.Process shape explicitly to avoid TS errors.
 */
const proc = globalThis.process as unknown as NodeJS.Process;

/* ---------- Robust startup diagnostics ---------- */
console.log("=== HAVN BOOT ===");
console.log("BOOT FILE:", import.meta.url);
console.log("NODE VERSION:", proc.version, "(all:", proc.versions, ")");
console.log("NODE_ENV:", proc.env.NODE_ENV);
console.log("RENDER_GIT_COMMIT:", proc.env.RENDER_GIT_COMMIT ?? "(none)");
console.log("PORT (env):", proc.env.PORT);
console.log("DATABASE_URL present:", typeof proc.env.DATABASE_URL === "string");

proc.on("unhandledRejection", (reason: unknown) => {
  console.error("UNHANDLED REJECTION:", reason);
});
proc.on("uncaughtException", (err: unknown) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
/* ------------------------------------------------ */

const app = express();
const PORT = Number(proc.env.PORT || 8080);

// CORS allowlist
const defaultAllow = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];
const extra = (proc.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const origins = [...new Set([...defaultAllow, ...extra])];

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: origins, methods: ["GET", "POST"], credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "havn-new",
    build: proc.env.RENDER_GIT_COMMIT ?? "local",
  });
});

// Routers
app.use("/api/properties", properties);
app.use("/api/listings", listings);
app.use("/api/debug", debug);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Boot
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HAVN API running on :${PORT}`);
});
