// src/routes/debug.ts
import { Router, Request, Response } from 'express';
import prisma from '../lib/db.js';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'havn-api' });
});

router.get('/db', async (_req: Request, res: Response) => {
  try {
    const count = await prisma.property.count();
    res.json({ ok: true, table: 'Property', count });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('/api/debug/db error', e);
    res.status(500).json({ ok: false, error: 'DB_ERROR' });
  }
});

export default router;
