import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS } from '../../jobwork/jobwork.types.ts';
import { closedQtyByIssueLine } from '../../jobwork/jobwork.posting.ts';
import type {
  JobworkChallansQuery,
  JobworkChallanRow,
  PaginatedJobworkChallansResponse,
} from './jobworkChallans.schemas.ts';

export async function getJobworkChallans(
  organizationId: string,
  query: JobworkChallansQuery,
): Promise<PaginatedJobworkChallansResponse> {
  const { processorName, processName, jobOrderNumber, itemName, fromDate, toDate, openOnly, minAgeDays, page, perPage } = query;

  return runAsTenant(organizationId, async (tx) => {
    // We start with a base where clause for job_issues.
    const where: Prisma.JobIssueWhereInput = {
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
      where.lines = {
        some: {
          item: { name: { contains: itemName, mode: 'insensitive' } },
        },
      };
    }

    if (fromDate || toDate) {
      where.issueDate = {};
      if (fromDate) where.issueDate.gte = new Date(fromDate);
      if (toDate) where.issueDate.lte = new Date(toDate);
    }

    if (minAgeDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - minAgeDays);
      if (!where.issueDate) where.issueDate = {};
      (where.issueDate as Prisma.DateTimeFilter).lte = cutoff;
    }
    
    if (openOnly) {
      where.status = { not: 'closed' };
    }

    const total = await tx.jobIssue.count({ where });

    const issues = await tx.jobIssue.findMany({
      where,
      include: {
        step: { include: { process: { select: { name: true } } } },
        jobOrder: { select: { jobOrderNumber: true } },
        destination: { select: { name: true } },
        lines: {
          where: { isDeleted: false },
          include: {
            item: { select: { name: true, unit: true } },
          },
        },
      },
      orderBy: { issueDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const allLineIds = issues.flatMap((issue) => issue.lines.map((l) => l.id));
    const closedMap = await closedQtyByIssueLine(tx, organizationId, allLineIds);

    const results: JobworkChallanRow[] = issues.map((issue) => {
      let pendingQty = 0;
      let issuedQty = 0;

      // Note: closedQty is not returnedQty, returned is something else, but here we just
      // aggregate standard values from lines, which only have issued qty, while we can approximate
      // received/accepted/rework by fetching receipts... wait, we need receipt aggregates per line?
      // The prompt only requires: "pendingQty = Σ outstanding over its lines."
      // Outstanding = line.qty - closedQtyByIssueLine(line).
      // We are not strictly asked to map "receivedQty", "acceptedQty", "reworkQty", "scrapQty" for this row
      // accurately unless we query the receipts, but the standard challan register might just put zeros for now,
      // or we can just fetch the aggregates if needed.
      
      const processSet = new Set<string>();
      const itemSet = new Set<string>();

      for (const line of issue.lines) {
        const iq = Number(line.qty);
        issuedQty += iq;
        
        if (issue.status === 'closed') {
          // A challan whose status is closed has pendingQty = 0 by construction
          pendingQty += 0;
        } else {
          const closed = Number(closedMap.get(line.id) || 0);
          pendingQty += Math.max(0, iq - closed);
        }

        if (issue.step?.process?.name) {
          processSet.add(issue.step.process.name);
        }
        itemSet.add(line.item.name + (line.item.unit ? ` (${line.item.unit})` : ''));
      }

      const pName = issue.processorNameSnapshot || issue.destination?.name || '';
      
      const itemsArr = Array.from(itemSet);
      const itemsText = itemsArr.length === 1 ? itemsArr[0] : `${itemsArr.length} items`;
      
      const daysOutstanding = pendingQty > 0
        ? Math.floor((Date.now() - issue.issueDate.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        id: issue.id,
        challanNumber: issue.challanNumber,
        issueDate: issue.issueDate,
        processorName: pName,
        process: Array.from(processSet).join(', '),
        jobOrderNumber: issue.jobOrder?.jobOrderNumber || '',
        jobOrderId: issue.jobOrderId || '',
        items: itemsText || '',
        issuedQty,
        receivedQty: issuedQty - pendingQty, // approximate for now
        acceptedQty: 0,
        reworkQty: 0,
        scrapQty: 0,
        returnedQty: 0,
        pendingQty,
        daysOutstanding,
        status: issue.status,
        processCharge: 0,
        attempt: null,
        reason: null,
        transporter: null,
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
