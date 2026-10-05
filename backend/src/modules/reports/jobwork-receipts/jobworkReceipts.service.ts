import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS } from '../../jobwork/jobwork.types.ts';
import type {
  JobworkReceiptsQuery,
  JobworkReceiptRow,
  PaginatedJobworkReceiptsResponse,
} from './jobworkReceipts.schemas.ts';

export async function getJobworkReceipts(
  organizationId: string,
  query: JobworkReceiptsQuery,
): Promise<PaginatedJobworkReceiptsResponse> {
  const {
    processorName,
    processName,
    jobOrderNumber,
    itemName,
    fromDate,
    toDate,
    minAgeDays,
    receiptNumber,
    status,
    issuedQty,
    receivedQty,
    acceptedQty,
    reworkQty,
    scrapQty,
    returnedQty,
    processChargeTotal,
    page,
    perPage,
  } = query;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.JobReceiptWhereInput = {
      organizationId,
      status: POSTED_DOC_STATUS,
      isDeleted: false,
    };

    if (processorName) {
      where.processorNameSnapshot = { contains: processorName, mode: 'insensitive' };
    }

    if (jobOrderNumber) {
      where.jobOrder = { jobOrderNumber: { contains: jobOrderNumber, mode: 'insensitive' } };
    }

    if (processName) {
      where.step = {
        process: { name: { contains: processName, mode: 'insensitive' } },
      };
    }

    if (itemName) {
      where.outputs = {
        some: {
          item: { name: { contains: itemName, mode: 'insensitive' } },
        },
      };
    }

    if (receiptNumber) {
      where.receiptNumber = { contains: receiptNumber, mode: 'insensitive' };
    }

    if (status) {
      where.status = status; // Exact match for status
    }

    if (issuedQty !== undefined) {
      where.totalIssuedQty = issuedQty;
    }
    if (receivedQty !== undefined) {
      where.totalReceivedQty = receivedQty;
    }
    if (acceptedQty !== undefined) {
      where.totalAcceptedQty = acceptedQty;
    }
    if (reworkQty !== undefined) {
      where.totalReworkQty = reworkQty;
    }
    if (scrapQty !== undefined) {
      where.totalScrapQty = scrapQty;
    }
    if (returnedQty !== undefined) {
      where.totalReturnedQty = returnedQty;
    }
    if (processChargeTotal !== undefined) {
      where.processChargeTotal = processChargeTotal;
    }

    if (fromDate || toDate) {
      where.receiptDate = {};
      if (fromDate) where.receiptDate.gte = new Date(fromDate);
      if (toDate) where.receiptDate.lte = new Date(toDate);
    }

    if (minAgeDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - minAgeDays);
      if (!where.receiptDate) where.receiptDate = {};
      (where.receiptDate as Prisma.DateTimeFilter).lte = cutoff;
    }

    const total = await tx.jobReceipt.count({ where });

    const receipts = await tx.jobReceipt.findMany({
      where,
      include: {
        step: { include: { process: { select: { name: true } }, outputs: true } },
        jobOrder: { select: { jobOrderNumber: true } },
        outputs: {
          include: {
            item: { select: { name: true, unit: true, stockingUom: { select: { symbol: true } } } },
          },
        },
      },
      orderBy: { receiptDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const stepIds = Array.from(new Set(receipts.map((r) => r.jobOrderStepId)));

    const allReceipts = await tx.jobReceipt.findMany({
      where: {
        organizationId,
        jobOrderStepId: { in: stepIds },
        status: POSTED_DOC_STATUS,
        isDeleted: false,
      },
      select: {
        jobOrderStepId: true,
        outputs: { select: { itemId: true, receivedQty: true } },
      },
    });

    const receivedMap = new Map<string, number>();
    for (const rec of allReceipts) {
      for (const out of rec.outputs) {
        const key = `${rec.jobOrderStepId}_${out.itemId}`;
        receivedMap.set(key, (receivedMap.get(key) || 0) + Number(out.receivedQty || 0));
      }
    }

    const results: JobworkReceiptRow[] = receipts.map((receipt) => {
      const pName = receipt.processorNameSnapshot || '';

      const lines = receipt.outputs.map((output) => {
        const unit = output.item.stockingUom?.symbol || output.item.unit;
        const itemNameWithUom = output.item.name + (unit ? ` (${unit})` : '');
        const plannedOutput = receipt.step?.outputs.find((o) => o.itemId === output.itemId);
        const plannedQty = plannedOutput?.expectedQty ? Number(plannedOutput.expectedQty) : 0;

        const receivedQty = Number(output.receivedQty || 0);

        const key = `${receipt.jobOrderStepId}_${output.itemId}`;
        const totalReceived = receivedMap.get(key) || 0;

        const toBeReceivedQty = Math.max(0, plannedQty - totalReceived);

        return {
          id: output.id,
          items: itemNameWithUom,
          plannedQty,
          receivedQty,
          toBeReceivedQty,
        };
      });

      return {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        receiptDate: receipt.receiptDate,
        processorName: pName,
        process: receipt.step?.process?.name || '',
        jobOrderNumber: receipt.jobOrder?.jobOrderNumber || '',
        jobOrderId: receipt.jobOrderId || '',
        lines,
        status: receipt.status,
      };
    });

    return {
      results,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  });
}
