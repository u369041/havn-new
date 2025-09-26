// src/routes/uploads.ts
import { Router, Request, Response } from "express";
import { createHash } from "node:crypto";

const router = Router();

/**
 * POST /api/uploads/cloudinary-signature
 * Returns { ok, timestamp, signature, apiKey, cloudName, folder }
 */
router.post("/cloudinary-signature", (_req: Request, res: Response) => {
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

export default router;
