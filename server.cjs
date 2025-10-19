// server.cjs  — fallback entrypoint to run directly with Node (no TS build)

// Load .env
require("dotenv/config");

// Imports
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

// Build fingerprint
const BUILD =
  process.env.RENDER_GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  new Date().toISOString();

// Middleware
app.use(helmet());
app.use(morgan("tiny"));
app.use(express.json({ limit: "5mb" }));

const allowedOrigins = [
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ---------- DEBUG ROUTES ---------- */

// Health check
app.get("/api/health", (_req, res) => {
  res.jso
