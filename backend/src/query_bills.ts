import { PrismaClient } from '../../generated/prisma/client.ts';

const prisma = new PrismaClient();

async function main() {
  const bills = await prisma.bill.findMany({
    where: {
      billNumber: {
        in: ['TR-BILL-RECIVE-01', 'TR-BILL-RECIVE-02', 'TR-BILL-RECIVE-03', 'RANA-BILL-001']
      }
    },
    include: {
      lineItems: true
    }
  });

  console.log(JSON.stringify(bills, null, 2));

  // Also check Job Receipts
  const receipts = await prisma.jobReceipt.findMany({
    where: {
      receiptNumber: {
        contains: 'TR-RECIVE'
      }
    }
  });
  console.log('Receipts:', JSON.stringify(receipts, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
