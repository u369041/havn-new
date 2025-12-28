import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import propertiesRouter from "./routes/properties";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";

const app = express();

// --- Middleware ---
app.use(helmet());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (adjust if needed)
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

// Rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
  })
);

// --- Health check MUST be early and fast ---
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// --- Routes ---
app.use("/api/properties", propertiesRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);

// --- Fallback ---
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not found" });
});

// --- START SERVER ---
// Render sets PORT. Locally you can default to 8080.
const PORT = Number(process.env.PORT || 8080);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HAVN API listening on ${PORT}`);
});
