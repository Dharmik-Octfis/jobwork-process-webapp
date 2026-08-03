import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../../lib/apiError.ts';
import { getMemberDirectory } from '../../../../lib/memberDirectory.ts';

/** Message for the (organizationId, currencyCode) unique index. */
const DUPLICATE_CODE = 'Currency code already exists in this organization.';

interface CreateCurrencyData {
  currencyCode: string;
  currencyName: string;
  symbol: string;
  decimalPlaces: number;
  format: string;
  exchangeRate: number;
  isActive?: boolean;
}

interface UpdateCurrencyData {
  currencyCode?: string;
  currencyName?: string;
  symbol?: string;
  decimalPlaces?: number;
  format?: string;
  exchangeRate?: number;
  isActive?: boolean;
}

/**
 * 🔴 "Created by" / "Modified by" resolve through the per-org member directory, NOT
 * through `createdByUser` on the `users` table.
 *
 * This used to `include: { createdByUser: { select: { firstName, lastName } } }`,
 * which reads the ACCOUNT name — the one name that is deliberately not what an
 * organization calls someone since per-org profiles landed (2026-07-30). Two orgs
 * would show the same spelling for the same person, and neither would match the
 * name in their own Users list.
 *
 * `lib/memberDirectory.ts` is the single place that mapping lives; it also handles
 * former members (still resolvable), migrations/seed writes ("System") and actors
 * who are not members of this org at all ("Support", never their real name). Any
 * other module that grows a created/modified column should call it the same way —
 * before `runAsTenant`, so it never acquires a second pooled connection while
 * holding a transaction.
 */
export const getCurrencyList = async (orgId: string) => {
  const directory = await getMemberDirectory(orgId);

  const rows = await runAsTenant(orgId, (tx) =>
    tx.currency.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
      },
      orderBy: {
        currencyCode: 'asc',
      },
    }),
  );

  return rows.map((row) => ({
    ...row,
    createdByName: directory.actorName(row.createdBy),
    updatedByName: directory.actorName(row.updatedBy),
  }));
};

export const createNewCurrency = async (
  orgId: string,
  data: CreateCurrencyData,
  userId?: string,
) => {
  return runAsTenant(orgId, async (tx) => {
    const existing = await tx.currency.findUnique({
      where: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        organizationId_currencyCode: {
          organizationId: orgId,
          currencyCode: data.currencyCode,
        },
      },
    });

    if (existing) {
      if (!existing.isDeleted) {
        throw ApiError.conflict(DUPLICATE_CODE);
      }
      return tx.currency.update({
        where: { id: existing.id },
        data: {
          currencyName: data.currencyName,
          symbol: data.symbol,
          decimalPlaces: data.decimalPlaces,
          format: data.format,
          exchangeRate: data.exchangeRate,
          isActive: data.isActive ?? true,
          isDeleted: false,
          updatedBy: userId,
        },
      });
    }

    return tx.currency.create({
      data: {
        organizationId: orgId,
        currencyCode: data.currencyCode,
        currencyName: data.currencyName,
        symbol: data.symbol,
        decimalPlaces: data.decimalPlaces,
        format: data.format,
        exchangeRate: data.exchangeRate,
        isActive: data.isActive ?? true,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  });
};

export const getCurrencyById = async (orgId: string, id: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.currency.findFirst({
      where: {
        id,
        organizationId: orgId,
        isDeleted: false,
      },
    }),
  );
};

export const updateCurrencyById = async (
  orgId: string,
  id: string,
  data: UpdateCurrencyData,
  userId?: string,
) => {
  return runAsTenant(orgId, async (tx) => {
    const existingCurrency = await tx.currency.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });

    if (!existingCurrency) {
      throw ApiError.notFound('Currency not found');
    }

    if (existingCurrency.currencyCode === 'INR') {
      if (data.isActive === false) {
        throw ApiError.badRequest('Default INR currency cannot be deactivated');
      }
      if (data.currencyCode && data.currencyCode !== 'INR') {
        throw ApiError.badRequest('Default INR currency code cannot be changed');
      }
    }

    return withUniqueViolation(DUPLICATE_CODE, () =>
      tx.currency.update({
        where: { id },
        data: {
          ...data,
          updatedBy: userId,
        },
      }),
    );
  });
};

export const deleteCurrencyById = async (orgId: string, id: string, userId?: string) => {
  return runAsTenant(orgId, async (tx) => {
    const existingCurrency = await tx.currency.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });

    if (!existingCurrency) {
      throw ApiError.notFound('Currency not found');
    }

    if (existingCurrency.currencyCode === 'INR') {
      throw ApiError.badRequest('Default INR currency cannot be deleted');
    }

    return tx.currency.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedBy: userId,
      },
    });
  });
};
