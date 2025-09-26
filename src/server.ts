// src/server.ts
import express, { Request, Response } from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import propertiesRouter from "./routes/properties.js";

const app = express();

app.use(express.json({ limit: "5mb" }));

// CORS allowlist
const ALLOWLIST = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com"
]);

type OriginCallback = (err: Error | null, allow?: boolean) => void;

const corsOptions = {
  origin(origin: string | undefined, callback: OriginCallback) {
    if (!origin) return callback(null, true);
    try {
      const u = new URL(origin);
      const normalized = `${u.protocol}//${u.host}`;
      if (ALLOWLIST.has(normalized)) return callback(null, true);
    } catch {
      // fall through to block
    }
    return callback(null, false);
  },
  credentials: true
};

app.use(cors(corsOptions as any));

// Health
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "havn-new" });
});

// Cloudinary signature + public config for client uploads
app.post("/api/uploads/cloudinary-signature", (_req: Request, res: Response) => {
  const {
    CLOUDINARY_API_SECRET,
    CLOUDINARY_API_KEY,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_FOLDER
  } = process.env;

  if (!CLOUDINARY_API_SECRET || !CLOUDINARY_API_KEY || !CLOUDINARY_CLOUD_NAME) {
    return res.status(500).json({ ok: false, error: "missing_cloudinary_env" });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash("sha1")
    .update(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest("hex");

  res.json({
    ok: true,
    timestamp,
    signature,
    apiKey: CLOUDINARY_API_KEY,
    cloudName: CLOUDINARY_CLOUD_NAME,
    folder: CLOUDINARY_FOLDER || "havn/properties"
  });
});

// Properties API
app.use("/api/properties", propertiesRouter);

// Boot (Render sets PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`havn-new listening on :${PORT}`);
});
