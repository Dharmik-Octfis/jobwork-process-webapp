import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';
import { POSTED_DOC_STATUS } from '../../jobwork/jobwork.types.ts';

export async function getJobOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    perPage?: number;
    pageSize?: number;
    jobOrderNumber?: string;
    processorName?: string;
    processName?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    jobOrderCustomFields?: Record<string, unknown>;
    targetDateFrom?: string;
    targetDateTo?: string;
    routeName?: string;
    ownership?: string;
    processorType?: string;
  }
) {
  const {
    page,
    perPage,
    pageSize = perPage,
    jobOrderNumber,
    processorName,
    processName,
    status,
    fromDate,
    toDate,
    targetDateFrom,
    targetDateTo,
    routeName,
    ownership,
    processorType,
    jobOrderCustomFields,
  } = params;
  const skip = pageSize && page ? (page - 1) * pageSize : undefined;

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

    if (targetDateFrom || targetDateTo) {
      where.targetDate = {};
      if (targetDateFrom) where.targetDate.gte = new Date(targetDateFrom);
      if (targetDateTo) where.targetDate.lte = new Date(targetDateTo);
    }

    if (routeName) {
      where.OR = [
        ...(where.OR || []),
        { routeNameSnapshot: { contains: routeName, mode: 'insensitive' } },
        { route: { name: { contains: routeName, mode: 'insensitive' } } },
      ];
    }

    if (ownership) {
      where.ownership = ownership;
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

    if (processorName || processName || processorType) {
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
      
      if (processorType) {
        where.steps.some!.processorType = processorType;
      }
    }

    const totalCount = await tx.jobOrder.count({ where });

    const jobOrders = await tx.jobOrder.findMany({
      where,
      orderBy: { orderDate: 'desc' },
      ...(pageSize ? { skip: skip ?? 0, take: pageSize } : {}),
      include: {
        route: { select: { name: true } },
        steps: {
          where: { isDeleted: false },
          include: {
            process: { select: { name: true, code: true } },
            workCentre: { select: { name: true } },
            issues: {
              where: { isDeleted: false, status: POSTED_DOC_STATUS },
              select: { processorNameSnapshot: true },
            },
          },
        },
      },
    });

    if (jobOrders.length === 0) {
      return { results: [], totalCount, page, pageSize };
    }

    const results = jobOrders.map((jo) => {
      const stepPairs: { process: string; doneBy: string; processorName: string }[] = [];

      for (const step of jo.steps) {
        const processName = step.process ? (step.process.code || step.process.name) : '-';
        const doneBy = step.processorType === 'in_house' ? 'In-house' : 'Vendor';
        
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
           existingPair = { process: processName, doneBy: doneBy, processorName: processorName };
           stepPairs.push(existingPair);
        }
      }

      return {
        id: jo.id,
        jobOrderNumber: jo.jobOrderNumber,
        orderDate: jo.orderDate,
        targetDate: jo.targetDate,
        route: jo.routeNameSnapshot || jo.route?.name || '-',
        materialBelongsTo: jo.ownership === 'customer' ? 'Customer’s' : 'Ours',
        status: jo.status,
        process: stepPairs.map(p => p.process),
        doneBy: stepPairs.map(p => p.doneBy),
        processorName: stepPairs.map(p => p.processorName),
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
