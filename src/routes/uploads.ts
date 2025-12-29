// src/routes/uploads.ts
import express from "express";
import crypto from "crypto";
import requireAuth from "../middleware/requireAuth";

const router = express.Router();

/**
 * Cloudinary signature endpoint
 *
 * Frontend calls this to get:
 * - timestamp
 * - signature
 * - cloudName
 * - apiKey
 *
 * Then frontend uploads direct to Cloudinary.
 *
 * SECURITY:
 * - Requires JWT auth so random people can't generate signatures.
 */
router.post("/cloudinary-signature", requireAuth, (req, res) => {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({
        ok: false,
        message:
          "Missing Cloudinary env vars. Need CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET",
      });
    }

    // optional folder from frontend (defaults to havn/properties)
    const folder =
      typeof req.body?.folder === "string" && req.body.folder.trim()
        ? req.body.folder.trim()
        : "havn/properties";

    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary expects the signature to be:
    // sha1("folder=...&timestamp=...<api_secret>")
    const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    return res.json({
      ok: true,
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
    });
  } catch (err: any) {
    console.error("cloudinary-signature error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to generate signature",
    });
  }
});

// OPTIONAL: allow GET for browser testing
router.get("/cloudinary-signature", requireAuth, (req, res) => {
  res.status(405).json({
    ok: false,
    message: "Use POST /api/uploads/cloudinary-signature",
  });
});

export default router;
