import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth";
import authPasswordRoutes from "./routes/auth-password";
import propertiesRoutes from "./routes/properties";
import adminRoutes from "./routes/admin";
import moderationRoutes from "./routes/moderation";
import uploadsRoutes from "./routes/uploads";
import diagRoutes from "./routes/diag";

const app = express();

/* -------------------------------------------------------
   GLOBAL MIDDLEWARE
------------------------------------------------------- */
app.use(helmet());
app.use(cors({
  origin: [
    "https://havn.ie",
    "https://www.havn.ie",
    "https://api.havn.ie"
  ],
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60
}));

/* -------------------------------------------------------
   ROUTES (ORDER MATTERS)
------------------------------------------------------- */

// Health / diagnostics
app.use("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/diag", diagRoutes);

// AUTH (LOGIN / SIGNUP)
app.use("/api/auth", authRoutes);

// 🔑 PASSWORD RESET (THIS WAS MISSING / BROKEN)
app.use("/api/auth", authPasswordRoutes);

// PROPERTIES
app.use("/api/properties", propertiesRoutes);

// ADMIN
app.use("/api/admin", adminRoutes);
app.use("/api/moderation", moderationRoutes);

// UPLOADS
app.use("/api/uploads", uploadsRoutes);

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`HAVN API listening on ${PORT}`);
});
