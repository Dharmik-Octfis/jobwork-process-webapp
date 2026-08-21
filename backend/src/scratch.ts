import { prisma } from './db/prisma.ts';

async function main() {
  const locations = await prisma.location.findMany();
  console.log('All Locations:', JSON.stringify(locations, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
