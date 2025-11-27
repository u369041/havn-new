// src/routes/properties.ts

import express from 'express';

const router = express.Router();

/**
 * Stub for legacy /api/properties routes.
 * The real properties API is implemented directly in src/server.ts.
 * This file exists only so TypeScript compiles without errors.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use /api/properties on the main server instead.',
  });
});

export default router;
