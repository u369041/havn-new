import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { properties } from "./routes/properties.js";
import { listings } from "./routes/listings.js";
import { debug } from "./routes/debug.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);

// CORS
const defaultAllow = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com"
];
const extra = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);
const origins = [...new Set([...defaultAllow, ...extra])];

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: origins, methods: ["GET","POST"], credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "havn-new",
    build: process.env.RENDER_GIT_COMMIT ?? "local"
  });
});

// Routers
app.use("/api/properties", properties);
app.use("/api/listings", listings);
app.use("/api/debug", debug);

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Boot
app.listen(PORT, () => {
  console.log(`✅ HAVN API running on :${PORT}`);
});
