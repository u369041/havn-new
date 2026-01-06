import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import uploadsRouter from "./routes/uploads";
import diagRouter from "./routes/diag";

// ✅ Admin feed (listings + status counts)
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

// ✅ ADMIN
// 1) Feed routes: /api/admin/properties, /api/admin/statuses, /api/admin/ping
app.use("/api/admin", adminRouter);

// 2) Moderation routes: /api/admin/properties/:id/approve, /api/admin/properties/:id/reject
app.use("/api/admin", moderationRouter);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HAVN API listening on ${PORT}`);
});
