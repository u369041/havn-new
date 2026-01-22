import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();

// ROUTES (adjust paths if your project uses different filenames)
import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import uploadsRouter from "./routes/uploads";
import debugRouter from "./routes/debug";
import adminPropertiesRouter from "./routes/admin-properties";

const app = express();

// ----- Security / middleware -----
app.use(helmet());

// 60 req/min baseline (matches your prior locked config)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: "2mb" }));

// ----- CORS (locked allowlist) -----
const ALLOWED_ORIGINS = new Set<string>([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server/no-origin requests
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ----- Health -----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ----- Route mounts -----
// Auth
app.use("/api/auth", authRouter);

// Uploads (Cloudinary signature endpoint etc)
app.use("/api/uploads", uploadsRouter);

// Properties (public browse, mine, draft create/save/submit, detail)
app.use("/api/properties", propertiesRouter);

// Debug/diag (if you have it; harmless if present)
app.use("/api/debug", debugRouter);

// ✅ NEW: Admin moderation compatibility endpoints (fixes your 404s)
app.use("/api/admin/properties", adminPropertiesRouter);

// ----- 404 fallback -----
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "NOT_FOUND" });
});

// ----- Error handler -----
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("SERVER_ERROR:", err);
  res.status(500).json({ ok: false, error: "SERVER_ERROR" });
});

// ----- Listen -----
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`HAVN API listening on :${port}`);
});
