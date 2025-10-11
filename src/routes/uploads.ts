import { Router, Request, Response } from "express";
import { v2 as cloudinary } from "cloudinary";

const router = Router();

/**
 * Cloudinary credentials (must be set in Render → Environment):
 * - CLOUDINARY_CLOUD_NAME
 * - CLOUDINARY_API_KEY
 * - CLOUDINARY_API_SECRET
 */
const {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.warn(
    "[uploads] Missing Cloudinary env vars. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
  );
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

/**
 * GET /api/uploads/cloudinary-signature
 * Generates and returns a Cloudinary signature payload
 */
router.get("/cloudinary-signature", async (_req: Request, res: Response) => {
  try {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return res.status(500).json({ ok: false, error: "cloudinary-env-missing" });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "havn/properties";

    const paramsToSign = { timestamp, folder };
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      CLOUDINARY_API_SECRET
    );

    res.json({
      signature,
      timestamp,
      api_key: CLOUDINARY_API_KEY,
      cloud_name: CLOUDINARY_CLOUD_NAME,
      folder,
    });
  } catch (err) {
    console.error("[uploads] Signature error:", err);
    res.status(500).json({ ok: false, error: "signature-failed" });
  }
});

export default router;
