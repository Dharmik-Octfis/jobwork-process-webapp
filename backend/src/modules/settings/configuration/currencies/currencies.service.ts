import { runAsTenant } from '../../../../db/prisma.ts';

interface CreateCurrencyData {
  currencyCode: string;
  currencyName: string;
  symbol: string;
  decimalPlaces: number;
}

interface UpdateCurrencyData {
  currencyCode?: string;
  currencyName?: string;
  symbol?: string;
  decimalPlaces?: number;
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
    })
  );
};

export const createNewCurrency = async (orgId: string, data: CreateCurrencyData, userId?: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.currency.create({
      data: {
        organizationId: orgId,
        currencyCode: data.currencyCode,
        currencyName: data.currencyName,
        symbol: data.symbol,
        decimalPlaces: data.decimalPlaces,
        createdBy: userId,
        updatedBy: userId,
      },
    })
  );
};

export const getCurrencyById = async (orgId: string, id: string) => {
  return runAsTenant(orgId, (tx) =>
    tx.currency.findFirst({
      where: {
        id,
        organizationId: orgId,
        isDeleted: false,
      },
    })
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
      throw new Error('Currency not found');
    }

    return tx.currency.update({
      where: { id },
      data: {
        ...data,
        updatedBy: userId,
      },
    });
  });
};

export const deleteCurrencyById = async (orgId: string, id: string, userId?: string) => {
  return runAsTenant(orgId, async (tx) => {
    const existingCurrency = await tx.currency.findFirst({
      where: { id, organizationId: orgId, isDeleted: false },
    });
    
    if (!existingCurrency) {
      throw new Error('Currency not found');
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
