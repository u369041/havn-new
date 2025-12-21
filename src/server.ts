﻿// src/server.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import diagRoutes from "./routes/_diag";
import authRoutes from "./routes/auth";
import propertiesMineRoutes from "./routes/properties.mine"; // /mine etc (must mount before /:slug)
import propertiesRoutes from "./routes/properties";          // includes /:slug routes + /:slug/archive
import uploadsRoutes from "./routes/uploads";
import debugRoutes from "./routes/debug";

const app = express();
app.set("trust proxy", 1);

// --- Security / middleware
app.use(helmet());
app.use(express.json({ limit: "25mb" }));

// CORS (prod + dev)
const allowedOrigins = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser tools (curl/postman) with no Origin header
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Rate limit (60 req/min per IP)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Routes
app.use("/api/_diag", diagRoutes);
app.use("/api/auth", authRoutes);

// IMPORTANT: mount /mine routes BEFORE /api/properties router that has "/:slug"
app.use("/api/properties", propertiesMineRoutes);

// Main properties router (includes public list, /:slug, and Step 9.2 /:slug/archive)
app.use("/api/properties", propertiesRoutes);

app.use("/api/uploads", uploadsRoutes);
app.use("/api/debug", debugRoutes);

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ ok: false, error: err?.message || "Server error" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => console.log(`HAVN API listening on ${port}`));
