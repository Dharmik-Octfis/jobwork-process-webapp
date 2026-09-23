import { PrismaClient } from './generated/prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  const ledgers = await prisma.stockLedgerEntry.findMany({
    take: 5,
  });
  console.log("Ledgers:", ledgers);
}

main().catch(console.error).finally(() => prisma.$disconnect());
