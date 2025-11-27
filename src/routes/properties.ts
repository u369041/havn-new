// src/routes/properties.ts

import express from 'express';

const router = express.Router();

/**
 * Stub for old /api/properties routes.
 *
 * The real, production properties endpoints are defined directly
 * in src/server.ts:
 *   - GET /api/properties
 *   - GET /api/properties/:slug
 *   - POST /api/properties
 *
 * This stub exists only so any app.use('/api/properties', propertiesRouter)
 * lines compile cleanly without Prisma/TS errors.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use /api/properties routes from server.ts instead.'
  });
});

export default router;
