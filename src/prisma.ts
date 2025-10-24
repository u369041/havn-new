import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance
export const prisma = new PrismaClient();

// If you previously added process.on(...) here and it caused typing errors,
// you can omit it (disconnect happens on process exit anyway).
// If you do want it, with @types/node installed this also works:
//
// process.on("beforeExit", async () => {
//   await prisma.$disconnect();
// });
