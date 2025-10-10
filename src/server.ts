import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';

import { apiRouter } from './routes/properties';

const app = express();

// basics
app.use(helmet());
app.use(
  cors({
    origin: '*',
  })
);
app.use(express.json({ limit: '2mb' }));

// simple root + health
app.get('/', (_req, res) => res.json({ ok: true, service: 'havn-api' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// mount API (this exposes /api/health and the properties routes)
app.use('/api', apiRouter);

// start
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
