import { Prisma } from '../../../../generated/prisma/client.ts';
import { runAsTenant } from '../../../db/prisma.ts';

export async function getJobOrdersReport(
  organizationId: string,
  params: {
    page?: number;
    pageSize?: number;
    jobOrderNumber?: string;
    processorName?: string;
    processName?: string;
  }
) {
  const { page = 1, pageSize = 20, jobOrderNumber, processorName, processName } = params;
  const skip = (page - 1) * pageSize;

  return runAsTenant(organizationId, async (tx) => {
    const where: Prisma.JobOrderWhereInput = {
      organizationId,
      isDeleted: false,
    };

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
          },
        },
      },
    });

    if (jobOrders.length === 0) {
      return { results: [], totalCount, page, pageSize };
    }

    // N+1 protection: get all step IDs for ledger aggregation
    const stepIds = jobOrders.flatMap((jo) => jo.steps.map((s) => s.id));

    // Ledger aggregation for sent/received quantities against steps
    const ledgerSums = stepIds.length > 0 ? await tx.stockLedgerEntry.groupBy({
      by: ['sourceDocId'],
      where: {
        organizationId,
        sourceDocType: 'job_order_step',
        sourceDocId: { in: stepIds },
      },
      _sum: {
        qtyIn: true,  // Total Received
        qtyOut: true, // Total Sent
      },
    }) : [];

    const ledgerMap = new Map(
      ledgerSums.map(s => [
        s.sourceDocId, 
        {
          receivedQty: Number(s._sum.qtyIn || 0),
          issuedQty: Number(s._sum.qtyOut || 0),
        }
      ])
    );

    const results = jobOrders.map((jo) => {
      const processSet = new Set<string>();
      const processorSet = new Set<string>();
      
      let totalIssued = 0;
      let totalReceived = 0;

      for (const step of jo.steps) {
        if (step.process?.name) {
          processSet.add(step.process.name);
        }
        if (step.processorNameSnapshot) {
          processorSet.add(step.processorNameSnapshot);
        }
        
        const sums = ledgerMap.get(step.id);
        if (sums) {
          totalIssued += sums.issuedQty;
          totalReceived += sums.receivedQty;
        }
      }

      return {
        id: jo.id,
        jobOrderNumber: jo.jobOrderNumber,
        orderDate: jo.orderDate,
        status: jo.status,
        process: Array.from(processSet).join(', '),
        processorName: Array.from(processorSet).join(', '),
        totalIssued,
        totalReceived,
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
