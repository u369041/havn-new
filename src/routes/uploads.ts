import { Router } from "express";
import crypto from "crypto";

const router = Router();

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
const apiKey = process.env.CLOUDINARY_API_KEY || "";
const apiSecret = process.env.CLOUDINARY_API_SECRET || "";
const defaultFolder = process.env.CLOUDINARY_FOLDER || "havn/properties";

// POST /api/uploads/cloudinary-signature
router.post("/cloudinary-signature", (req, res) => {
  const timestamp = Math.floor(Date.now() / 1000);

  // Optional per-request folder (works if express.json is enabled; otherwise defaults)
  const folder =
    (req.body && typeof req.body.folder === "string" && req.body.folder.trim()) ||
    defaultFolder;

  // Sign folder + timestamp with your API secret
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  res.json({
    ok: true,
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder
  });
});

export default router;
