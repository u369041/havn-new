import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import uploadsRouter from "./routes/uploads";
import diagRouter from "./routes/diag";

// ✅ Admin feed / ping etc
import adminRouter from "./routes/admin";

// ✅ Approve/Reject moderation routes
import moderationRouter from "./routes/moderation";

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

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ✅ DIAG
app.use("/api/_diag", diagRouter);

// ✅ CORE
app.use("/api/properties", propertiesRouter);
app.use("/api/auth", authRouter);
app.use("/api/uploads", uploadsRouter);

/**
 * ✅ ADMIN
 * IMPORTANT:
 * - moderationRouter MUST be mounted BEFORE adminRouter
 * - because both are under /api/admin and adminRouter currently has legacy handlers
 *   that otherwise intercept /properties/:id/approve|reject first.
 */

// 1) Moderation routes FIRST: /api/admin/properties/:id/approve + /reject
app.use("/api/admin", moderationRouter);

// 2) Admin misc routes AFTER: /api/admin/ping etc
app.use("/api/admin", adminRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HAVN API listening on ${PORT}`);
});
