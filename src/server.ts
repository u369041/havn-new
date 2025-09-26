// src/server.ts
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import propertiesRouter from "./routes/properties.js";

const app = express();

app.use(express.json({ limit: "5mb" }));

// CORS allowlist
const ALLOWLIST = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        if (ALLOWLIST.has(`${u.protocol}//${u.host}`)) return cb(null, true);
      } catch {}
      return cb(new Error("CORS blocked"));
    },
    credentials: true,
  })
);

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "havn-new" });
});

// Cloudinary signature
app.post("/api/uploads/cloudinary-signature", (_req, res) => {
  const { CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_API_SECRET) {
    return res
      .status(500)
      .json({ ok: false, error: "missing_cloudinary_secret" });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha1")
    .update(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest("hex");
  res.json({ ok: true, timestamp, signature });
});

// Properties API
app.use("/api/properties", propertiesRouter);

// Boot (Render sets PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`havn-new listening on :${PORT}`);
});
