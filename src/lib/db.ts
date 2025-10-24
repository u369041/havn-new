import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// graceful shutdown
async function shutdown() {
  try {
    await prisma.$disconnect();
  } catch (e) {
    // ignore
  } finally {
    // nothing
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
