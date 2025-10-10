// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";

const app = express();

// Basic middleware
app.use(express.json({ limit: "1mb" }));
app.use(cors());
app.use(helmet());

// Simple global rate limit (safe defaults)
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120,            // 120 requests/min per IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health checks (Render looks for these)
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ⬇️ This is the “mount”: all routes from propertiesRouter live under /api/...
app.use("/api", propertiesRouter);

// Optional: 404 for unknown /api routes
app.use("/api/*", (_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// Start server (Render provides PORT)
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
