// src/routes/uploads.ts
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';

const router = Router();

/**
 * POST /api/uploads/cloudinary-signature
 * Body: { paramsToSign: { timestamp: number, [public_id], [folder], [eager], ... } }
 * Header: X-Admin-Key: <ADMIN_KEY>
 */
router.post('/cloudinary-signature', async (req: Request, res: Response) => {
  try {
    const adminKey = req.header('X-Admin-Key');
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({ ok: false, error: 'CLOUDINARY_ENV_MISSING' });
    }

    const paramsToSign = (req.body?.paramsToSign ?? {}) as Record<string, string | number>;

    // Cloudinary signature: sort keys alphabetically, join as key=value&..., append api_secret, sha1
    const sortedKeys = Object.keys(paramsToSign).sort();
    const toSign = sortedKeys
      .filter((k) => paramsToSign[k] !== undefined && paramsToSign[k] !== null && paramsToSign[k] !== '')
      .map((k) => `${k}=${paramsToSign[k]}`)
      .join('&');

    const signature = crypto
      .createHash('sha1')
      .update(toSign + apiSecret)
      .digest('hex');

    return res.json({
      ok: true,
      signature,
      cloudName,
      apiKey
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('POST /api/uploads/cloudinary-signature error', err);
    res.status(500).json({ ok: false, error: 'SERVER_ERROR' });
  }
});

export default router;
