import { prisma } from './src/db/prisma.ts';

async function main() {
  const count = await prisma.stockLedgerEntry.count();
  console.log("Total ledger entries:", count);
  
  const orgs = await prisma.organization.findMany();
  console.log("Orgs:", orgs.map(o => o.id));
}

main().catch(console.error).finally(() => prisma.$disconnect());
