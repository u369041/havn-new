// src/routes/listings.ts

import express from 'express';

const router = express.Router();

/**
 * Simple stub for /api/listings routes.
 * We only need /api/properties for HAVN right now.
 * This avoids TypeScript/Prisma errors on non-existent fields like listingType.
 */

router.get('/', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Listings endpoint not implemented yet. Use /api/properties instead.'
  });
});

export default router;
