// src/routes/uploads.ts

import express from 'express';

const router = express.Router();

/**
 * This router is currently a no-op stub.
 * The real Cloudinary signature endpoint lives in src/server.ts at:
 *   POST /api/uploads/cloudinary-signature
 *
 * We keep this file just so imports like:
 *   app.use('/api/uploads', uploadsRouter);
 * still work without TypeScript errors.
 */

router.get('/ping', (_req, res) => {
  res.json({ ok: true, message: 'uploads router stub' });
});

export default router;
