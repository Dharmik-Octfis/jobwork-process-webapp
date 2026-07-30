import { runAsTenant } from '../../../../db/prisma.ts';
import { ApiError, withUniqueViolation } from '../../../../lib/apiError.ts';

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

export const getCurrencyList = async (orgId: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.currency.findMany({
      where: {
        organizationId: orgId,
        isDeleted: false,
      },
      orderBy: {
        currencyCode: 'asc',
      },
      include: {
        createdByUser: {
          select: { firstName: true, lastName: true },
        },
        updatedByUser: {
          select: { firstName: true, lastName: true },
        },
      },
    }),
  );
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

    return tx.currency.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedBy: userId,
      },
    });
  });
};
