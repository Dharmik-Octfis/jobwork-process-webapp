import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS } from '../../jobwork/jobwork.types.ts';

import type {
  JobworkChallansQuery,
  JobworkChallanRow,
  PaginatedJobworkChallansResponse,
} from './jobworkChallans.schemas.ts';

export async function getJobworkChallans(
  organizationId: string,
  query: JobworkChallansQuery,
): Promise<PaginatedJobworkChallansResponse> {
  const { processorName, processName, jobOrderNumber, itemName, fromDate, toDate, minAgeDays, page, perPage } = query;

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
    
    // We do NOT override status here for openOnly. 'closed' status doesn't exist,
    // and overwriting would remove POSTED_DOC_STATUS (allowing drafts/cancelled).

    const issues = await tx.jobIssue.findMany({
      where,
      include: {
        step: { 
          include: { 
            process: { select: { name: true } },
            inputs: { select: { itemId: true, plannedQty: true } }
          } 
        },
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

    const stepIds = Array.from(new Set(issues.map((i) => i.jobOrderStepId)));
    
    // Fetch all lines for these steps to calculate total issued so far
    const stepIssues = await tx.jobIssue.findMany({
      where: {
        jobOrderStepId: { in: stepIds },
        status: POSTED_DOC_STATUS,
        isDeleted: false,
      },
      select: {
        jobOrderStepId: true,
        lines: {
          where: { isDeleted: false },
          select: { itemId: true, qty: true },
        },
      },
    });

    const issuedMap = new Map<string, number>();
    for (const si of stepIssues) {
      for (const line of si.lines) {
        const key = `${si.jobOrderStepId}_${line.itemId}`;
        issuedMap.set(key, (issuedMap.get(key) || 0) + Number(line.qty));
      }
    }

    const results: JobworkChallanRow[] = issues.map((issue) => {
      const pName = issue.processorNameSnapshot || issue.destination?.name || '';
      const processName = issue.step?.process?.name || '';

      const lines = issue.lines.map((line) => {
        const itemNameWithUom = line.item.name + (line.item.unit ? ` (${line.item.unit})` : '');
        const plannedInput = issue.step?.inputs.find((i) => i.itemId === line.itemId);
        const plannedQty = plannedInput?.plannedQty ? Number(plannedInput.plannedQty) : 0;
        
        const issuedQty = Number(line.qty);
        
        const key = `${issue.jobOrderStepId}_${line.itemId}`;
        const totalIssued = issuedMap.get(key) || 0;
        
        const toBeIssuedQty = Math.max(0, plannedQty - totalIssued);

        return {
          id: line.id,
          items: itemNameWithUom,
          plannedQty,
          issuedQty,
          toBeIssuedQty,
        };
      });

      const daysOutstanding = Math.floor((Date.now() - issue.issueDate.getTime()) / (1000 * 60 * 60 * 24));

      return {
        id: issue.id,
        challanNumber: issue.challanNumber,
        issueDate: issue.issueDate,
        processorName: pName,
        process: processName,
        jobOrderNumber: issue.jobOrder?.jobOrderNumber || '',
        jobOrderId: issue.jobOrderId || '',
        lines,
        daysOutstanding,
        status: issue.status,
      };
    });

    const finalTotal = await tx.jobIssue.count({ where });

    return {
      results,
      total: finalTotal,
      page,
      perPage,
      totalPages: Math.ceil(finalTotal / perPage),
    };
  });
}
