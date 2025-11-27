// src/routes/properties.ts

import express from 'express';

const router = express.Router();

/**
 * Stub router for /api/properties.
 *
 * The real implementation is in src/server.ts where we define:
 *   GET /api/properties
 *   GET /api/properties/:slug
 *   POST /api/properties
 *
 * We keep this file only so any app.use('/api/properties', propertiesRouter)
 * calls continue to work without TypeScript errors.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use the main /api/properties endpoints defined in server.ts.',
  });
});

router.get('/:slug', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use the main /api/properties/:slug endpoint defined in server.ts.',
  });
});

export default router;
