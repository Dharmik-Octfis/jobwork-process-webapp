/**
 * RECEIPT BILLS → CHARGE ONLY (2026-09-23) — one-off correction for bills raised
 * from a job receipt before a receipt bill line had to be a service.
 *
 * Those lines carried the OUTPUT goods item at material + charge, so the bill asked
 * the job worker to be paid for our own fabric. Job work is valued at receipt; the
 * bill settles the charge only. Each such line becomes the process's service item ×
 * the output's accepted qty at the receipt's agreed rate, amount = the receipt's
 * charge for that output (₹0 stays ₹0). The bill's totals move by the same amount.
 * The old line discount is dropped: it was taken on material + charge.
 *
 * It also clears stock tracking on service items that never moved, and turns
 * "service" items that DO have stock movements back into goods (their stock and
 * history are untouched).
 *
 * 🔴 IT WRITES NOTHING WITHOUT `--apply`. Take `npm run db:backup` first, and run it
 * while nobody is entering bills.
 *
 *     npx tsx scripts/fix-receipt-bills.ts                 # every organization, dry run
 *     npx tsx scripts/fix-receipt-bills.ts --org <uuid>    # one organization
 *     npx tsx scripts/fix-receipt-bills.ts --apply
 *
 * A line whose process has no service item of the same name is listed and left
 * alone — create the service item, then re-run. Safe to re-run: a line already on a
 * service item is skipped.
 */
import { Prisma } from '../generated/prisma/client.ts';
import { prisma, runAsTenant } from '../src/db/prisma.ts';

const APPLY = process.argv.includes('--apply');
const orgArg = process.argv.indexOf('--org');
const ONLY_ORG = orgArg >= 0 ? process.argv[orgArg + 1] : undefined;
const ZERO = new Prisma.Decimal(0);
const key = (name: string) => name.trim().toLowerCase();

console.log(APPLY ? '\n=== APPLYING ===\n' : '\n=== DRY RUN — nothing will be written ===\n');

const orgs = await prisma.organization.findMany({
  where: ONLY_ORG ? { id: ONLY_ORG } : {},
  select: { id: true, name: true },
  orderBy: { name: 'asc' },
});

let lineCount = 0;
let missing = 0;

for (const org of orgs) {
  const report = await runAsTenant(
    org.id,
    async (tx) => {
      const out: string[] = [];

      const lines = await tx.billItem.findMany({
        where: {
          jobReceiptId: { not: null },
          isDeleted: false,
          bill: { organizationId: org.id, isDeleted: false },
          item: { itemType: { not: 'service' } },
        },
        select: {
          id: true,
          billId: true,
          itemId: true,
          quantity: true,
          rate: true,
          itemTotal: true,
          bill: { select: { billNumber: true, subTotal: true, totalAmount: true } },
          item: { select: { name: true } },
          jobReceipt: {
            select: {
              receiptNumber: true,
              step: { select: { process: { select: { name: true } } } },
              outputs: {
                where: { isDeleted: false },
                select: { itemId: true, acceptedQty: true, rate: true, processCharge: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const services = await tx.item.findMany({
        where: { organizationId: org.id, itemType: 'service', isDeleted: false },
        select: { id: true, name: true },
      });
      const serviceByName = new Map(services.map((item) => [key(item.name), item]));

      const deltaByBill = new Map<string, Prisma.Decimal>();
      for (const line of lines) {
        const receipt = line.jobReceipt!;
        const processName = receipt.step.process.name;
        const service = serviceByName.get(key(processName));
        const output = receipt.outputs.find((row) => row.itemId === line.itemId);
        const label = `${line.bill.billNumber} / ${receipt.receiptNumber}`;
        if (!service || !output) {
          missing++;
          out.push(
            `  ✗ ${label}: ${!service ? `no service item named "${processName}"` : 'no receipt output for this item'} — left alone`,
          );
          continue;
        }
        const amount = output.processCharge.toDecimalPlaces(2);
        const rate = output.rate ?? ZERO;
        out.push(
          `  ${label}: ${line.item.name} ${line.quantity} × ${line.rate} = ${line.itemTotal}` +
            `  →  ${service.name} ${output.acceptedQty} × ${rate} = ${amount}`,
        );
        lineCount++;
        deltaByBill.set(
          line.billId,
          (deltaByBill.get(line.billId) ?? ZERO).plus(amount.minus(line.itemTotal)),
        );
        if (APPLY) {
          await tx.billItem.update({
            where: { id: line.id },
            data: {
              itemId: service.id,
              quantity: output.acceptedQty,
              rate,
              discountPercentage: null,
              discount: null,
              itemTotal: amount,
            },
          });
        }
      }

      for (const [billId, delta] of deltaByBill) {
        const bill = lines.find((line) => line.billId === billId)!.bill;
        out.push(
          `  bill ${bill.billNumber}: total ${bill.totalAmount} → ${bill.totalAmount.plus(delta)}`,
        );
        if (APPLY) {
          await tx.bill.update({
            where: { id: billId },
            data: {
              subTotal: bill.subTotal.plus(delta),
              totalAmount: bill.totalAmount.plus(delta),
              activities: {
                create: {
                  title: 'Bill Corrected',
                  description:
                    'Job receipt lines re-stated as the job work charge only; the material was ours and is valued on the receipt.',
                  performedBy: 'System',
                },
              },
            },
          });
        }
      }

      // Services never stock; a "service" that has moved stock is goods mislabelled.
      const trackedServices = await tx.item.findMany({
        where: {
          organizationId: org.id,
          itemType: 'service',
          trackInventory: true,
          isDeleted: false,
        },
        select: { id: true, name: true },
      });
      for (const item of trackedServices) {
        const moved = await tx.stockLedgerEntry.count({
          where: { organizationId: org.id, itemId: item.id },
        });
        if (moved > 0) {
          out.push(`  item ${item.name}: service → goods (${moved} stock movements kept)`);
          if (APPLY) await tx.item.update({ where: { id: item.id }, data: { itemType: 'goods' } });
        } else {
          out.push(`  item ${item.name}: stock tracking off`);
          if (APPLY) {
            await tx.item.update({
              where: { id: item.id },
              data: { trackInventory: false, inventoryTracking: 'none' },
            });
          }
        }
      }
      return out;
    },
    { maxWait: 15_000, timeout: 300_000 },
  );

  if (report.length > 0) {
    console.log(`${org.name}`);
    for (const row of report) console.log(row);
  }
}

console.log(
  `\n${lineCount} line(s) ${APPLY ? 'corrected' : 'to correct'}, ${missing} left alone.` +
    (APPLY ? '' : ' Re-run with --apply to write.'),
);
await prisma.$disconnect();
