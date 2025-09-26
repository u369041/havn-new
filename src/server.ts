import express, { Request, Response } from "express";
import cors from "cors";
import propertiesRouter from "./routes/properties.js";
import uploadsRouter from "./routes/uploads.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// CORS allowlist
const ALLOWLIST = new Set([
  "https://havn.ie",
  "https://www.havn.ie",
  "https://havn-new.onrender.com"
]);

type OriginCb = (err: Error | null, allow?: boolean) => void;

app.use(
  cors({
    origin(origin: string | undefined, cb: OriginCb) {
      if (!origin) return cb(null, true);
      try {
        const u = new URL(origin);
        const normalized = `${u.protocol}//${u.host}`;
        if (ALLOWLIST.has(normalized)) return cb(null, true);
      } catch {}
      return cb(null, false);
    },
    credentials: true
  } as any)
);

// Health
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "havn-new" });
});

// Uploads (Cloudinary signature)
app.use("/api/uploads", uploadsRouter);

// Properties API
app.use("/api/properties", propertiesRouter);

// Boot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`havn-new listening on :${PORT}`);
});
