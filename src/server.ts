import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import uploadsRouter from "./routes/uploads";
import diagRouter from "./routes/diag";

// ✅ MODERATION ROUTER (approve/reject)
import moderationRouter from "./routes/moderation";

const app = express();

// ✅ Security + parsing
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ CORS locked to havn.ie + render preview domain
app.use(
  cors({
    origin: [
      "https://havn.ie",
      "https://www.havn.ie",
      "https://havn-new.onrender.com",
    ],
    credentials: true,
  })
);

// ✅ Basic rate limiting
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// ✅ Fast health check (must always work)
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ✅ DIAG ROUTES (restored)
app.use("/api/_diag", diagRouter);

// ✅ CORE ROUTES
app.use("/api/properties", propertiesRouter);
app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);

// ✅ ADMIN MODERATION ROUTES
// This exposes:
// POST /api/admin/properties/:id/approve
// POST /api/admin/properties/:id/reject
app.use("/api/admin", moderationRouter);

// ✅ Admin ping route (nice for quick verification)
app.get("/api/admin/ping", (req, res) => {
  res.json({ ok: true, route: "admin", ts: Date.now() });
});

// ✅ 404 fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HAVN API listening on ${PORT}`);
});
