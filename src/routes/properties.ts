// src/routes/properties.ts

import express from 'express';

const router = express.Router();

/**
 * Stub router.
 * The real /api/properties endpoints are defined in src/server.ts.
 * This file exists only so any app.use('/api/properties', propertiesRouter)
 * lines compile without TypeScript / Prisma errors.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use /api/properties defined in server.ts instead of routes/properties.ts',
  });
});

export default router;
