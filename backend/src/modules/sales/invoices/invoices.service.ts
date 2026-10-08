import { runAsTenant } from '../../../db/prisma.ts';
import { approvalExecutionService } from '../../automation/approval-processes/approvalExecution.service.ts';
import { ensureApprovalTables } from '../../automation/approval-processes/approvalTables.migration.ts';
import { Prisma } from '../../../../generated/prisma/client.ts';
import type { CreateInvoicePayload, UpdateInvoicePayload } from './invoices.schemas.ts';
import { searchWhere, pageSlice, takeForPage, type ListQuery } from '../../../lib/pagination.ts';
import { filterWhere } from '../../settings/list-views/listFilters.catalog.ts';
import { ApiError, withUniqueViolation } from '../../../lib/apiError.ts';
import { assertOnOrAfterMigration } from '../../../lib/migrationDate.ts';
import { priceLines } from '../../../lib/linePricing.ts';
import { allocateOutward } from '../../inventory/stock-ledger/allocateOutward.ts';
import {
  postMovements,
  reverseMovement,
} from '../../inventory/stock-ledger/stockLedger.service.ts';
const DUPLICATE_NUMBER = 'A Invoice with this Invoice Number already exists.';

function invoiceListWhere(organizationId: string, opts: ListQuery): Prisma.InvoiceWhereInput {
  const baseWhere: Prisma.InvoiceWhereInput = {
    organizationId: organizationId,
    isDeleted: false,
    ...filterWhere<Prisma.InvoiceWhereInput>('invoice', opts.filter),
    ...searchWhere<Prisma.InvoiceWhereInput>(opts.search, [
      'invoiceNumber',
      'notes',
      'paymentTerms',
      'status',
    ]),
  };

  if (opts.fieldFilters) {
    try {
      const filters = JSON.parse(opts.fieldFilters) as Record<string, unknown>;
      if (filters.customerId) {
        baseWhere.customerId = filters.customerId as string;
      }
    } catch (_e) {
      // Ignore invalid JSON
    }
  }

  return baseWhere;
}

export async function getInvoicesList(organizationId: string, opts: ListQuery) {
  const { page, perPage } = opts;
  return runAsTenant(organizationId, async (tx) => {
    const rows = await tx.invoice.findMany({
      where: invoiceListWhere(organizationId, opts),
      orderBy: { date: 'desc' },
      skip: (page - 1) * perPage,
      take: takeForPage(perPage),
      include: {
        customer: { select: { contactName: true } },
        location: true,
      },
    });

    return pageSlice(rows, page, perPage);
  });
}

export async function countInvoices(organizationId: string, opts: ListQuery): Promise<number> {
  return runAsTenant(organizationId, (tx) =>
    tx.invoice.count({ where: invoiceListWhere(organizationId, opts) }),
  );
}

export async function getInvoiceById(orgId: string, id: string) {
  return runAsTenant(orgId, (tx) =>
    tx.invoice.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
      include: {
        lineItems: {
          where: { isDeleted: false },
          include: { item: true },
        },
        customer: { select: { contactName: true, email: true, phone: true, addresses: true } },
        location: true,
      },
    }),
  );
}

export async function createInvoice(orgId: string, userId: string, data: CreateInvoicePayload) {
  const { lineItems: rawLineItems, ...soData } = data;
  const { lines: lineItems, subTotal, totalAmount } = priceLines(rawLineItems);
  return runAsTenant(orgId, async (tx) => {
    await assertOnOrAfterMigration(tx, {
      organizationId: orgId,
      date: soData.date,
      field: 'date',
      label: 'Invoice',
    });

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    const seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId: orgId, entityType: 'invoice' } },
    });

    if (seq) {
      if (soData.invoiceNumber.startsWith(seq.prefix)) {
        const suffixPart = soData.invoiceNumber.slice(seq.prefix.length);
        const match = suffixPart.match(/^0*(\d+)/);
        let newNextNumber = seq.nextNumber + 1;
        if (match && match[1]) {
          const extracted = parseInt(match[1], 10);
          if (!isNaN(extracted) && extracted >= seq.nextNumber) {
            newNextNumber = extracted + 1;
          }
        }
        await tx.numberSequence.update({
          where: { id: seq.id },
          data: { nextNumber: newNextNumber },
        });
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, async () => {
      const invoice = await tx.invoice.create({
        data: {
          ...soData,
          subTotal,
          totalAmount,
          organizationId: orgId,
          createdBy: userId,
          updatedBy: userId,
          documents: (soData.documents ?? []) as Prisma.InputJsonValue,
          customFields: (soData.customFields ?? {}) as Prisma.InputJsonObject,
          lineItems: {
            create: lineItems.map((item) => ({
              ...item,
              customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
              createdBy: userId,
              updatedBy: userId,
            })),
          },
          activities: {
            create: [
              {
                title: 'Invoice Created',
                description: `Invoice "${soData.invoiceNumber}" created.`,
                performedBy,
                createdBy: userId,
                updatedBy: userId,
              },
            ],
          },
        },
        include: { lineItems: true },
      });

      if (invoice.status !== 'Draft' && invoice.status !== 'Pending Approval') {
        if (!invoice.locationId) {
          throw ApiError.badRequest('Location is required for an active invoice to deduct stock.');
        }
        const requests = invoice.lineItems.map((item, index) => ({
          itemId: item.itemId,
          name: `Invoice Line ${index + 1}`,
          required: new Prisma.Decimal(item.quantity),
        }));

        if (requests.length > 0) {
          const allocations = await allocateOutward(tx, {
            organizationId: orgId,
            locationId: invoice.locationId,
            requests,
            taking: 'invoiced',
            detailKey: 'lines',
          });

          const movementInputs = [];
          for (const alloc of allocations) {
            const line = invoice.lineItems[alloc.requestIndex];
            if (!line) continue;
            movementInputs.push({
              organizationId: orgId,
              batchId: alloc.batchId,
              batchUnitId: alloc.batchUnitId,
              locationId: invoice.locationId!,
              movementType: 'issue' as const,
              stockEffect: 'both' as const,
              qtyOut: alloc.qty,
              sourceDocType: 'invoice' as const,
              sourceDocId: invoice.id,
              sourceDocLineId: line.id,
              postedAt: invoice.date,
              userId: userId,
            });
          }
          if (movementInputs.length > 0) {
            await postMovements(tx, movementInputs);
          }
        }

        if (invoice.salesOrderId) {
          await tx.salesOrder.updateMany({
            where: { id: invoice.salesOrderId, status: { not: 'Closed' } },
            data: { status: 'Closed' },
          });
        }
      }

      if (invoice.status === 'Pending Approval') {
        await ensureApprovalTables();
        const outcome = await approvalExecutionService.evaluateAndTriggerApproval(
          orgId,
          'invoices',
          invoice.id,
          `Invoice #${invoice.invoiceNumber}`,
          null,
          invoice as unknown as Record<string, unknown>,
          userId ?? undefined,
        );
        if (!outcome.triggered && !outcome.requestId) {
          throw ApiError.badRequest('No matching active approval rule found for this invoice.');
        }
      }
      return invoice;
    });
  });
}

export async function updateInvoice(
  orgId: string,
  id: string,
  userId: string,
  data: UpdateInvoicePayload,
) {
  // totals move only with the lines they are summed from
  const { lineItems: rawLineItems, subTotal: _s, totalAmount: _t, ...soData } = data;
  const priced = rawLineItems ? priceLines(rawLineItems) : undefined;
  const lineItems = priced?.lines;
  return runAsTenant(orgId, async (tx) => {
    if (soData.date !== undefined) {
      await assertOnOrAfterMigration(tx, {
        organizationId: orgId,
        date: soData.date,
        field: 'date',
        label: 'Invoice',
      });
    }

    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return withUniqueViolation(DUPLICATE_NUMBER, async () => {
      const so = await tx.invoice.updateMany({
        where: { id, organizationId: orgId, isDeleted: false },
        data: {
          ...soData,
          subTotal: priced?.subTotal,
          totalAmount: priced?.totalAmount,
          updatedBy: userId,
          documents:
            soData.documents !== undefined
              ? (soData.documents as Prisma.InputJsonValue)
              : undefined,
          customFields:
            soData.customFields !== undefined
              ? (soData.customFields as Prisma.InputJsonObject)
              : undefined,
        },
      });

      if (lineItems) {
        await tx.invoiceItem.updateMany({
          where: { invoiceId: id },
          data: { isDeleted: true, updatedBy: userId },
        });
        for (const item of lineItems) {
          await tx.invoiceItem.create({
            data: {
              ...item,
              id: undefined,
              invoiceId: id,
              createdBy: userId,
              updatedBy: userId,
              customFields: (item.customFields ?? {}) as Prisma.InputJsonObject,
            },
          });
        }
      }

      await tx.invoiceActivity.create({
        data: {
          invoiceId: id,
          title: 'Invoice Updated',
          description: `Invoice ${soData.invoiceNumber || ''} updated.`,
          performedBy,
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Reverse existing stock entries for this invoice
      const oldEntries = await tx.stockLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          sourceDocType: 'invoice',
          sourceDocId: id,
          movementType: 'issue',
        },
      });
      for (const entry of oldEntries) {
        await reverseMovement(tx, orgId, entry.id, {
          sourceDocType: 'invoice',
          sourceDocId: id,
          userId,
        });
      }

      // Re-allocate if the new status is not Draft or Pending Approval
      const fullInvoice = await tx.invoice.findUnique({
        where: { id },
        include: { lineItems: { where: { isDeleted: false } } },
      });
      const checkStatus = soData.status ?? fullInvoice?.status ?? 'Draft';
      const locId = soData.locationId !== undefined ? soData.locationId : fullInvoice?.locationId;

      if (checkStatus !== 'Draft' && checkStatus !== 'Pending Approval') {
        if (!locId) {
          throw ApiError.badRequest('Location is required for an active invoice to deduct stock.');
        }
        const currentLines = lineItems ?? fullInvoice?.lineItems ?? [];
        if (currentLines.length > 0) {
          const requests = currentLines.map((item, index) => ({
            itemId: item.itemId,
            name: `Invoice Line ${index + 1}`,
            required: new Prisma.Decimal(item.quantity),
          }));

          const allocations = await allocateOutward(tx, {
            organizationId: orgId,
            locationId: locId,
            requests,
            taking: 'invoiced',
            detailKey: 'lines',
          });

          const movementInputs = [];
          for (const alloc of allocations) {
            const line = currentLines[alloc.requestIndex];
            if (!line) continue;
            movementInputs.push({
              organizationId: orgId,
              batchId: alloc.batchId,
              batchUnitId: alloc.batchUnitId,
              locationId: locId,
              movementType: 'issue' as const,
              stockEffect: 'both' as const,
              qtyOut: alloc.qty,
              sourceDocType: 'invoice' as const,
              sourceDocId: id,
              sourceDocLineId: line.id ?? id, // fallback if new line
              postedAt: fullInvoice!.date,
              userId: userId,
            });
          }
          if (movementInputs.length > 0) {
            await postMovements(tx, movementInputs);
          }
        }

        if (fullInvoice?.salesOrderId) {
          await tx.salesOrder.updateMany({
            where: { id: fullInvoice.salesOrderId, status: { not: 'Closed' } },
            data: { status: 'Closed', updatedBy: userId },
          });
        }
      }

      if (soData.status === 'Pending Approval') {
        if (fullInvoice) {
          await ensureApprovalTables();
          const outcome = await approvalExecutionService.evaluateAndTriggerApproval(
            orgId,
            'invoices',
            id,
            `Invoice #${fullInvoice.invoiceNumber}`,
            null,
            fullInvoice as unknown as Record<string, unknown>,
            userId ?? undefined,
          );
          if (!outcome.triggered && !outcome.requestId) {
            throw ApiError.badRequest('No matching active approval rule found for this invoice.');
          }
        }
      }

      return so;
    });
  });
}

export async function getInvoiceActivities(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.invoiceActivity.findMany({
      where: {
        invoiceId: id,
        isDeleted: false,
        invoice: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function deleteInvoice(orgId: string, id: string, userId?: string) {
  return runAsTenant(orgId, async (tx) => {
    // reverse existing stock entries
    const oldEntries = await tx.stockLedgerEntry.findMany({
      where: {
        organizationId: orgId,
        sourceDocType: 'invoice',
        sourceDocId: id,
        movementType: 'issue',
      },
    });
    for (const entry of oldEntries) {
      await reverseMovement(tx, orgId, entry.id, {
        sourceDocType: 'invoice',
        sourceDocId: id,
        userId,
      });
    }

    return tx.invoice.updateMany({
      where: { id, organizationId: orgId, isDeleted: false },
      data: { isDeleted: true },
    });
  });
}

export async function getInvoiceNumberPreference(organizationId: string) {
  return runAsTenant(organizationId, async (tx) => {
    let seq = await tx.numberSequence.findUnique({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'invoice' } },
    });

    if (!seq) {
      seq = await tx.numberSequence.create({
        data: {
          organizationId,
          entityType: 'invoice',
          prefix: 'INV-',
          nextNumber: 1,
        },
      });
    }

    return seq;
  });
}

export async function updateInvoiceNumberPreference(
  organizationId: string,
  prefix: string,
  nextNumber: number,
) {
  return runAsTenant(organizationId, async (tx) => {
    return tx.numberSequence.upsert({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      where: { organizationId_entityType: { organizationId, entityType: 'invoice' } },
      create: {
        organizationId,
        entityType: 'invoice',
        prefix,
        nextNumber,
      },
      update: {
        prefix,
        nextNumber,
      },
    });
  });
}

export async function getInvoiceComments(organizationId: string, id: string) {
  return runAsTenant(organizationId, (tx) =>
    tx.invoiceComment.findMany({
      where: {
        invoiceId: id,
        isDeleted: false,
        invoice: {
          organizationId: organizationId,
          isDeleted: false,
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

export async function createInvoiceComment(
  organizationId: string,
  id: string,
  content: string,
  userId: string | null,
) {
  return runAsTenant(organizationId, async (tx) => {
    let performedBy = 'System';
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (user) {
        performedBy = `${user.fullName || user.firstName || 'User'} (User)`;
      }
    }

    return tx.invoiceComment.create({
      data: {
        invoiceId: id,
        content,
        performedBy,
        createdBy: userId ?? null,
        updatedBy: userId ?? null,
      },
    });
  });
}

export async function deleteInvoiceComment(
  organizationId: string,
  invoiceId: string,
  commentId: string,
  userId?: string,
) {
  return runAsTenant(organizationId, async (tx) => {
    const existingComment = await tx.invoiceComment.findFirst({
      where: {
        id: commentId,
        invoiceId,
        isDeleted: false,
        invoice: { organizationId: organizationId },
      },
    });

    if (!existingComment) {
      throw ApiError.notFound('Comment not found');
    }

    return tx.invoiceComment.update({
      where: { id: commentId },
      data: { isDeleted: true, updatedBy: userId ?? null },
    });
  });
}
