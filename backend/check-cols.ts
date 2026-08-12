import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRawUnsafe(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'item_location_stocks'"
  );
  console.log("Columns for item_location_stocks:");
  console.log(result);
}

main().catch(console.error).finally(() => prisma.$disconnect());
