// src/server.ts

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import propertiesRouter from "./routes/properties";

// import package.json to expose app version
// (tsconfig has "resolveJsonModule": true)
import pkg from "../package.json" assert { type: "json" };

const app = express();

/* -------- Build/commit metadata -------- */
const BUILD_TIME = process.env.BUILD_TIME || new Date().toISOString();
const GIT_SHA =
  process.env.RENDER_GIT_COMMIT || process.env.GIT_SHA || "local-dev";
const GIT_BRANCH =
  process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || "local";
const APP_VERSION = (pkg as any).version || "0.0.0";

/* ---------------- Security & basics ---------------- */
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: "2mb" }));

/* ---------------- CORS ---------------- */
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

/* ---------------- Health & Version ---------------- */
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    time: new Date().toISOString(),
  });
});

/** Prove what’s deployed */
app.get("/api/version", (_req, res) => {
  res.json({
    ok: true,
    appVersion: APP_VERSION,
    git: { sha: GIT_SHA, branch: GIT_BRANCH },
    buildTime: BUILD_TIME,
    node: process.version,
    env: process.env.NODE_ENV || "development",
  });
});

/* ---------------- Routes ---------------- */
app.use("/api/properties", propertiesRouter);

/* ---------------- Start server ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HAVN API running on port ${PORT}`);
  if (!process.env.DATABASE_URL) {
    console.warn(
      "Warning: DATABASE_URL is not set. Prisma will fail to connect until you set it in .env"
    );
  }
});

export default app;
