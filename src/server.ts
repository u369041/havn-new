import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import moderationRouter from "./routes/moderation";
import uploadsRouter from "./routes/uploads";
import diagRouter from "./routes/diag";

const app = express();

app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// ✅ Must be fast and always available
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * ✅ HARD VERIFY ADMIN ROUTING IS LIVE
 * If this is NOT reachable after deploy, Render is not deploying your latest build.
 */
app.get("/api/admin/ping", (req, res) => {
  res.json({ ok: true, route: "admin-ping", ts: new Date().toISOString() });
});

/**
 * ✅ HARD VERIFY DEPLOYED COMMIT
 * Helps detect wrong branch / old build / stale deploy instantly.
 */
app.get("/api/_diag/build", (req, res) => {
  res.json({
    ok: true,
    build: process.env.RENDER_GIT_COMMIT || "unknown",
    ts: new Date().toISOString(),
  });
});

// ✅ DIAG ROUTES (RESTORED)
app.use("/api/_diag", diagRouter);

// ✅ API routes
app.use("/api/properties", propertiesRouter);
app.use("/api/auth", authRouter);

// ✅ Admin routes (MUST exist)
app.use("/api/admin", adminRouter);
app.use("/api/admin", moderationRouter);

// ✅ Uploads
app.use("/api/uploads", uploadsRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HAVN API listening on ${PORT}`);
});
