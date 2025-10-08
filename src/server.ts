// src/server.ts

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

import propertiesRouter from "./routes/properties"; // ← full file you just pasted

const app = express();

/* ---------------- Security & basics ---------------- */
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60,             // 60 req/min per IP
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: "2mb" }));

/* ---------------- CORS ----------------
   Allow localhost in dev, havn.ie in prod, and your Render fallback.
--------------------------------------------------- */
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
      // allow same-origin / curl (no Origin header) & allow listed origins
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

/* ---------------- Health ---------------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "healthy", time: new Date().toISOString() });
});

/* ---------------- Routes ---------------- */
app.use("/api/properties", propertiesRouter);

// If you already have an uploads/signature route in another file, mount it here:
// import uploadsRouter from "./routes/uploads";
// app.use("/api/uploads", uploadsRouter);

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
