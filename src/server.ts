import express from "express";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import propertiesRouter from "./routes/properties";
import uploadsRouter from "./routes/uploads";
import debugRouter from "./routes/debug";
import adminPropertiesRouter from "./routes/admin-properties";

const app = express();

/* security */
app.use(helmet());
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

/* body */
app.use(express.json({ limit: "2mb" }));

/* CORS — FIXED + PRE-FLIGHT SAFE */
const ALLOWED = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // server-to-server / curl etc (no Origin header)
    if (!origin) return cb(null, true);

    // allow known origins
    if (ALLOWED.has(origin)) return cb(null, true);

    // IMPORTANT: do NOT throw errors here — just deny CORS
    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

// ✅ This is the key: respond to preflight for ALL routes
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

/* health */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/* routes */
app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/admin/properties", adminPropertiesRouter);
app.use("/api/debug", debugRouter);

/* 404 fallback */
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND" });
});

/* error handler */
app.use((err: any, req: any, res: any, _next: any) => {
  console.error("SERVER_ERROR:", err);

  // Best-effort CORS header even on errors (prevents silent ERR_FAILED)
  const origin = req.headers?.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.status(500).json({ ok: false, error: "SERVER_ERROR" });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => {
  console.log(`HAVN API running on ${PORT}`);
});
