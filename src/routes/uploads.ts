import { Router, Request, Response } from "express";
import crypto from "crypto";

const router = Router();

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function pickFolder(req: Request) {
  const fromBody = (req.body && typeof (req.body as any).folder === "string")
    ? String((req.body as any).folder).trim()
    : "";

  // default
  return fromBody || "havn/properties";
}

function buildSignaturePayload(folder: string) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  const envStatus = {
    hasCloudName: !!cloudName,
    hasApiKey: !!apiKey,
    hasApiSecret: !!apiSecret,
  };

  if (!cloudName || !apiKey || !apiSecret) {
    return {
      ok: false as const,
      status: 500,
      body: {
        ok: false,
        message:
          "Missing Cloudinary env vars. Require CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
        envStatus,
      },
    };
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Cloudinary signs a string like: folder=...&timestamp=... + apiSecret
  // (if you include additional params in upload, they must also be included here)
  const stringToSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = sha1(stringToSign);

  return {
    ok: true as const,
    status: 200,
    body: {
      ok: true,
      cloudName,
      apiKey,
      timestamp,
      folder,
      signature,
      envStatus,
    },
  };
}

/**
 * POST /api/uploads/cloudinary-signature
 * This is what your members upload page calls.
 */
router.post("/cloudinary-signature", (req: Request, res: Response) => {
  try {
    const folder = pickFolder(req);
    const out = buildSignaturePayload(folder);
    return res.status(out.status).json(out.body);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: err?.message || "Cloudinary signature error",
    });
  }
});

/**
 * GET /api/uploads/cloudinary-signature
 * Keep this for backwards compatibility / quick browser checks.
 */
router.get("/cloudinary-signature", (req: Request, res: Response) => {
  try {
    const folder =
      typeof req.query.folder === "string" && req.query.folder.trim()
        ? req.query.folder.trim()
        : "havn/properties";

    const out = buildSignaturePayload(folder);
    return res.status(out.status).json(out.body);
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: err?.message || "Cloudinary signature error",
    });
  }
});

export default router;
