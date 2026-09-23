const { PrismaClient } = require('./src/generated/prisma/client');
const prisma = new PrismaClient();
async function main() {
  const bill = await prisma.bill.findFirst({ where: { billNumber: 'RANAB001' }, include: { lineItems: true } });
  if (!bill) {
    console.log('Bill not found');
    return;
  }
  console.log('Bill ID:', bill.id, 'Lines:', bill.lineItems.length);
  const ledger = await prisma.stockLedgerEntry.findMany({ where: { sourceDocId: bill.id }, orderBy: { postedAt: 'asc' } });
  console.log(ledger.map(l => ({ id: l.id, in: l.qtyIn, out: l.qtyOut, effect: l.stockEffect, type: l.movementType })));
}
main().finally(() => prisma.$disconnect());
