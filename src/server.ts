import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth";
import propertiesRoutes from "./routes/properties";
import uploadsRoutes from "./routes/uploads";
import debugRoutes from "./routes/debug";
import diagRoutes from "./routes/_diag";

const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const allowed = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowed.has(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ diagnostics
app.use("/api/_diag", diagRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/properties", propertiesRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/debug", debugRoutes);

// ✅ GLOBAL ERROR HANDLER
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({
    ok: false,
    error: err?.message || "Server error",
    stack: process.env.NODE_ENV === "production" ? undefined : String(err?.stack || ""),
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => {
  console.log(`HAVN API listening on ${port}`);
});
