import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { apiRouter } from './routes/properties';

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://havn.ie',
    'https://www.havn.ie',
    'https://havn-new.onrender.com',
  ],
}));
app.use(express.json({ limit: '10mb' }));

// rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
});
app.use(limiter);

// mount API routes
app.use('/api', apiRouter);

// health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'API running' });
});

// root route
app.get('/', (_req, res) => {
  res.send('HAVN API is live 🚀');
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
