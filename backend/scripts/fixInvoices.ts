import { prisma, runAsTenant } from '../src/db/prisma.ts';

async function main() {
  console.log('Fixing invoice postedAt dates...');

  // Organizations have no RLS, so we can find them all
  const orgs = await prisma.organization.findMany();
  console.log(`Found ${orgs.length} organizations.`);

  let updatedCount = 0;

  for (const org of orgs) {
    console.log(`Processing org: ${org.id}`);
    await runAsTenant(org.id, async (tx) => {
      const invoiceEntries = await tx.stockLedgerEntry.findMany({
        where: {
          sourceDocType: 'invoice',
        },
      });

      console.log(`  Found ${invoiceEntries.length} invoice ledger entries in org ${org.id}.`);

      for (const entry of invoiceEntries) {
        if (entry.sourceDocId) {
          const invoice = await tx.invoice.findUnique({
            where: { id: entry.sourceDocId },
          });

          if (invoice && invoice.date) {
            await tx.stockLedgerEntry.update({
              where: { id: entry.id },
              data: { postedAt: invoice.date },
            });
            updatedCount++;
          }
        }
      }
    });
  }

  console.log(`Successfully updated ${updatedCount} invoice ledger entries.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
