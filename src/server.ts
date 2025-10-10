// src/server.ts
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

import propertiesRouter from './routes/properties';

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// very light rate limit (tweak as you like)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --- Health routes ---
// Render is configured to check /api/health; we also expose /health for flexibility.
async function healthHandler(_: express.Request, res: express.Response) {
  try {
    // Optional DB ping; if Neon is sleeping this may add a second, but it’s useful
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ ok: true });
  } catch (err) {
    // Still return 200 so Render doesn't flap; include info for logs
    console.error('Health check error:', err);
    res.status(200).json({ ok: true, db: 'unavailable' });
  }
}

app.get('/api/health', healthHandler);
app.get('/health', healthHandler);

// --- API routers ---
app.use('/api', propertiesRouter);

// Fallback root
app.get('/', (_req, res) => {
  res.status(200).send('OK');
});

// Start
const PORT = Number(process.env.PORT) || 3000;
// IMPORTANT on Render: bind to 0.0.0.0
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;
