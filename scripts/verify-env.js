import "dotenv/config";
import { PrismaClient } from "@prisma/client";
async function main() {
    const ok = (label, pass) => console.log(`${pass ? "✅" : "❌"} ${label} ${pass ? "present" : "missing"}`);
    ok("DATABASE_URL", !!process.env.DATABASE_URL);
    ok("SEED_TOKEN", !!process.env.SEED_TOKEN);
    const prisma = new PrismaClient();
    try {
        await prisma.$queryRawUnsafe("SELECT 1;");
        console.log("✅ DB connectivity OK");
    }
    catch (e) {
        console.error("❌ DB connectivity FAILED", e);
    }
    finally {
        await prisma.$disconnect();
    }
}
main();
