import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Graceful shutdown
const shutdown = async () => {
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
