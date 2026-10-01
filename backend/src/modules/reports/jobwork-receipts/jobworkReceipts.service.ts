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
  const { processorName, processName, jobOrderNumber, itemName, fromDate, toDate, minAgeDays, receiptNumber, status, issuedQty, receivedQty, acceptedQty, reworkQty, scrapQty, returnedQty, processChargeTotal, page, perPage } = query;

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
        step: { include: { process: { select: { name: true } } } },
        jobOrder: { select: { jobOrderNumber: true } },
        outputs: {
          include: {
            item: { select: { name: true, unit: true } },
          },
        },
      },
      orderBy: { receiptDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const results: JobworkReceiptRow[] = receipts.map((receipt) => {
      const itemSet = new Set<string>();

      for (const output of receipt.outputs) {
        itemSet.add(output.item.name + (output.item.unit ? ` (${output.item.unit})` : ''));
      }

      const pName = receipt.processorNameSnapshot || '';
      const itemsArr = Array.from(itemSet);
      const itemsText = itemsArr.length === 1 ? itemsArr[0] : `${itemsArr.length} items`;
      
      return {
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        receiptDate: receipt.receiptDate,
        processorName: pName,
        process: receipt.step?.process?.name || '',
        jobOrderNumber: receipt.jobOrder?.jobOrderNumber || '',
        jobOrderId: receipt.jobOrderId || '',
        items: itemsText || '',
        issuedQty: Number(receipt.totalIssuedQty),
        receivedQty: Number(receipt.totalReceivedQty),
        acceptedQty: Number(receipt.totalAcceptedQty),
        reworkQty: Number(receipt.totalReworkQty),
        scrapQty: Number(receipt.totalScrapQty),
        returnedQty: Number(receipt.totalReturnedQty),
        status: receipt.status,
        processChargeTotal: Number(receipt.processChargeTotal),
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
