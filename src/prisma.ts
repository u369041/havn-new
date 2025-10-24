import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Be polite on shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
