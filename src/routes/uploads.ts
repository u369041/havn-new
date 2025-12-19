import { Router } from "express";
import crypto from "crypto";

const router = Router();

/**
 * GET /api/uploads/cloudinary-signature
 * Returns safe upload signing data (never returns API secret).
 */
router.get("/cloudinary-signature", (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    const folder = "havn/properties";

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

    const timestamp = Math.floor(Date.now() / 1000);

    // Must sign folder + timestamp if folder is sent during upload
    const stringToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(stringToSign).digest("hex");

    return res.json({
      ok: true,
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      envStatus,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: err?.message || "Cloudinary signature error",
    });
  }
});

export default router;
