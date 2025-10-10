// src/server.ts

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { apiRouter } from './routes/properties'; // adjust if your router file is named differently

// Init Prisma
const prisma = new PrismaClient();

// Init express
const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting (basic: 300 requests/min per IP)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health checks
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// API routes
app.use('/api', apiRouter);

// Example root route
app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Welcome to havn-new API' });
});

// Global error handler (catch-all)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ ok: false, error: 'Internal Server Error' });
});

// Start server
const port = process.env.PORT ? Number(process.env.PORT) : 10000;
app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
