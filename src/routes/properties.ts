// src/routes/properties.ts

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apiRouter = Router();

// GET /api/properties -> list all properties
apiRouter.get('/properties', async (_req, res) => {
  try {
    const properties = await prisma.property.findMany({
      include: { images: true },
    });
    res.json({ ok: true, properties });
  } catch (err) {
    console.error('Error fetching properties:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch properties' });
  }
});

// POST /api/properties -> create new property
apiRouter.post('/properties', async (req, res) => {
  try {
    const { title, price, description } = req.body;
    const property = await prisma.property.create({
      data: { title, price, description },
    });
    res.json({ ok: true, property });
  } catch (err) {
    console.error('Error creating property:', err);
    res.status(500).json({ ok: false, error: 'Failed to create property' });
  }
});

export { apiRouter };
