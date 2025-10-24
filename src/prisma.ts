import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// NOTE: Removed process.on('beforeExit', ...) because your TS setup
// narrows `process` to `{ env: ProcessEnv }`, which flags `.on` as invalid.
// Prisma will still disconnect when the process exits.
