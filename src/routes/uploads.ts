import { Router } from "express";
import crypto from "crypto";

const router = Router();

/**
 * GET /api/uploads/cloudinary-signature
 *
 * Returns SAFE values only:
 * - cloudName
 * - apiKey
 * - timestamp
 * - folder
 * - signature
 *
 * Also returns envStatus booleans for debugging (no secrets leaked).
 */
router.get("/cloudinary-signature", (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    // This MUST match what the frontend sends
    const folder = "havn/properties";

    // Diagnostic flags (safe to expose)
    const envStatus = {
      hasCloudName: !!cloudName,
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret,
    };

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({
        ok: false,
        message:
          "Missing Cloudinary env vars. Require CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
        envStatus,
      });
    }

    // Unix timestamp (seconds)
    const timestamp = Math.floor(Date.now() / 1000);

    /**
     * Cloudinary signature rules:
     * - Include EVERY param you send (folder, timestamp)
     * - Alphabetical order
     * - Append API secret at the end
     */
    const stringToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto
      .createHash("sha1")
      .update(stringToSign)
      .digest("hex");

    return res.json({
      ok: true,
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      envStatus, // proves env vars exist at runtime
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: err?.message || "Cloudinary signature error",
    });
  }
});

export default router;
