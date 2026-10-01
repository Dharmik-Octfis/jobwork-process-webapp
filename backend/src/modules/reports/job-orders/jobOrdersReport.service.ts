import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS } from '../../jobwork/jobwork.types.ts';

export async function getJobOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    jobOrderNumber?: string;
    processorName?: string;
    processName?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    jobOrderCustomFields?: Record<string, unknown>;
  }
) {
  const {
    page = 1,
    pageSize = 20,
    jobOrderNumber,
    processorName,
    processName,
    status,
    fromDate,
    toDate,
    jobOrderCustomFields,
  } = params;
  const skip = (page - 1) * pageSize;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.JobOrderWhereInput = {
      organizationId,
      isDeleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (fromDate || toDate) {
      where.orderDate = {};
      if (fromDate) where.orderDate.gte = new Date(fromDate);
      if (toDate) where.orderDate.lte = new Date(toDate);
    }

    if (jobOrderCustomFields) {
      const customFieldsWhere: Prisma.JobOrderWhereInput[] = [];
      Object.entries(jobOrderCustomFields).forEach(([cfKey, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          if (Array.isArray(value)) {
            customFieldsWhere.push({
              OR: value.map((v) => ({
                customFields: { path: [cfKey], array_contains: v },
              })),
            });
          } else {
            customFieldsWhere.push({
              OR: [
                { customFields: { path: [cfKey], equals: value } },
                { customFields: { path: [cfKey], array_contains: value } },
              ],
            });
          }
        }
      });
      if (customFieldsWhere.length > 0) {
        where.AND = customFieldsWhere;
      }
    }

    if (jobOrderNumber) {
      where.jobOrderNumber = { contains: jobOrderNumber, mode: 'insensitive' };
    }

    if (processorName || processName) {
      where.steps = {
        some: {
          isDeleted: false,
        },
      };
      
      if (processorName) {
        where.steps.some!.processorNameSnapshot = { contains: processorName, mode: 'insensitive' };
      }
      
      if (processName) {
        where.steps.some!.process = { name: { contains: processName, mode: 'insensitive' } };
      }
    }

    const totalCount = await tx.jobOrder.count({ where });

    const jobOrders = await tx.jobOrder.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      skip,
      take: pageSize,
      include: {
        steps: {
          where: { isDeleted: false },
          include: {
            process: { select: { name: true } },
            workCentre: { select: { name: true } },
            issues: {
              where: { isDeleted: false, status: POSTED_DOC_STATUS },
              select: { totalQty: true, processorNameSnapshot: true },
            },
            receipts: {
              where: { isDeleted: false, status: POSTED_DOC_STATUS },
              select: { totalReceivedQty: true },
            },
          },
        },
      },
    });

    if (jobOrders.length === 0) {
      return { results: [], totalCount, page, pageSize };
    }

    const results = jobOrders.map((jo) => {
      const stepPairs: { process: string; processorName: string; totalIssued: number; totalReceived: number }[] = [];

      for (const step of jo.steps) {
        const processName = step.process?.name || '-';
        
        let pName = step.processorNameSnapshot;
        if (!pName && step.processorType === 'in_house' && step.workCentre?.name) {
          pName = step.workCentre.name;
        }
        if (!pName && step.issues.length > 0) {
          pName = step.issues.find(i => i.processorNameSnapshot)?.processorNameSnapshot ?? null;
        }
        
        const processorName = pName || '-';

        let existingPair = stepPairs.find(p => p.process === processName && p.processorName === processorName);
        if (!existingPair) {
           existingPair = { process: processName, processorName: processorName, totalIssued: 0, totalReceived: 0 };
           stepPairs.push(existingPair);
        }
        
        for (const issue of step.issues) {
          existingPair.totalIssued += Number(issue.totalQty || 0);
        }
        
        for (const receipt of step.receipts) {
          existingPair.totalReceived += Number(receipt.totalReceivedQty || 0);
        }
      }

      return {
        id: jo.id,
        jobOrderNumber: jo.jobOrderNumber,
        orderDate: jo.orderDate,
        status: jo.status,
        process: stepPairs.map(p => p.process),
        processorName: stepPairs.map(p => p.processorName),
        totalIssued: stepPairs.map(p => p.totalIssued),
        totalReceived: stepPairs.map(p => p.totalReceived),
        pendingQty: stepPairs.map(p => Math.max(0, p.totalIssued - p.totalReceived)),
      };
    });

    return {
      results,
      totalCount,
      page,
      pageSize,
    };
  });
}
