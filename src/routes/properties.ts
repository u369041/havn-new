// src/routes/properties.ts

import express from 'express';

const router = express.Router();

/**
 * Stub router for /api/properties.
 * The real implementation lives in src/server.ts.
 * This file exists only so imports like `app.use('/api/properties', propertiesRouter)`
 * do not break the build.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Use /api/properties defined in server.ts instead of this stub.'
  });
});

export default router;
