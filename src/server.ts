import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRouter from "./routes/auth";
import propertiesRouter from "./routes/properties";
import uploadsRouter from "./routes/uploads";
import debugRouter from "./routes/debug";
import adminPropertiesRouter from "./routes/admin-properties";
import moderationRouter from "./routes/moderation";
import stripeRouter from "./routes/stripe";

const app = express();

/* security */
app.use(helmet());

/*
  STRICT limiter (keep protection where it matters)
*/
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/* body */
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "2mb" }));

/* CORS */
const ALLOWED = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

const corsOptions = {
  origin(origin: any, cb: any) {
    if (!origin) return cb(null, true);
    if (ALLOWED.has(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  optionsSuccessStatus: 204,
};

app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

/* health */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/*
  ROUTES
  ✅ NO limiter on properties → unlimited browsing
*/
app.use("/api/properties", propertiesRouter);

/*
  🔒 Protected routes stay rate-limited
*/
app.use("/api/auth", strictLimiter, authRouter);
app.use("/api/uploads", strictLimiter, uploadsRouter);
app.use("/api/admin", strictLimiter, moderationRouter);
app.use("/api/admin/properties", strictLimiter, adminPropertiesRouter);
app.use("/api/debug", strictLimiter, debugRouter);

/* 404 */
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND" });
});

/* error handler */
app.use((err: any, req: any, res: any, _next: any) => {
  console.error("SERVER_ERROR:", err);

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