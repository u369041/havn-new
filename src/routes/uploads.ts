import { Router } from "express";
import crypto from "crypto";

const router = Router();

/**
 * If you use Cloudinary unsigned uploads, you won't need this.
 * For signed uploads, PUT your Cloudinary keys in env, then call this
 * to fetch a signature for the front-end.
 */
router.get("/cloudinary-signature", (req, res) => {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
    return res.status(400).json({ ok: false, error: "cloudinary-env-missing" });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(paramsToSign + CLOUDINARY_API_SECRET)
    .digest("hex");

  res.json({
    ok: true,
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    timestamp,
    signature
  });
});

export default router;
