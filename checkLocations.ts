import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const terms = [
    "Blackrock",
    "Greystones",
    "Douglas",
    "Ballincollig",
    "Dooradoyle"
  ];

  for (const term of terms) {
    const rows = await prisma.location.findMany({
      where: {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { canonicalName: { contains: term, mode: "insensitive" } },
          { displayName: { contains: term, mode: "insensitive" } },
          { aliases: { has: term } },
          { searchTerms: { has: term } }
        ]
      },
      select: {
        id: true,
        slug: true,
        name: true,
        canonicalName: true,
        displayName: true,
        type: true,
        county: true,
        aliases: true,
        searchTerms: true,
        searchable: true,
        isActive: true
      },
      orderBy: {
        id: "asc"
      }
    });

    console.log(`\n===== ${term} =====`);
    console.table(rows);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
