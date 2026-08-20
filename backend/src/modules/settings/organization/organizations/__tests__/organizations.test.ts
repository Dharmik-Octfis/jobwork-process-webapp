import { describe, it, expect } from 'vitest';
import { createOrganizationSchema } from '../organizations.schemas.ts';

describe('Organizations Schemas', () => {
  it('validates a correct payload', () => {
    const payload = {
      name: 'Acme Corp',
      portalName: 'acmecorp',
      industryType: 'technology',
    };

    const result = createOrganizationSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('rejects payload missing name', () => {
    const payload = {
      portalName: 'acmecorp',
    };

    const result = createOrganizationSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

describe('getDefaultCurrencyForCountry', () => {
  it('returns INR for India (IN, IND, India)', async () => {
    const { getDefaultCurrencyForCountry } = await import('../organizations.controller.ts');
    expect(getDefaultCurrencyForCountry('IN')).toEqual({
      currencyCode: 'INR',
      currencyName: 'Indian Rupee',
      symbol: '₹',
    });
    expect(getDefaultCurrencyForCountry('IND')).toEqual({
      currencyCode: 'INR',
      currencyName: 'Indian Rupee',
      symbol: '₹',
    });
    expect(getDefaultCurrencyForCountry('India')).toEqual({
      currencyCode: 'INR',
      currencyName: 'Indian Rupee',
      symbol: '₹',
    });
  });

  it('returns CAD for Canada (CA, CAN, Canada)', async () => {
    const { getDefaultCurrencyForCountry } = await import('../organizations.controller.ts');
    expect(getDefaultCurrencyForCountry('CA')).toEqual({
      currencyCode: 'CAD',
      currencyName: 'Canadian Dollar',
      symbol: 'CA$',
    });
    expect(getDefaultCurrencyForCountry('Canada')).toEqual({
      currencyCode: 'CAD',
      currencyName: 'Canadian Dollar',
      symbol: 'CA$',
    });
  });

  it('returns USD for any other country or undefined', async () => {
    const { getDefaultCurrencyForCountry } = await import('../organizations.controller.ts');
    expect(getDefaultCurrencyForCountry('US')).toEqual({
      currencyCode: 'USD',
      currencyName: 'US Dollar',
      symbol: '$',
    });
    expect(getDefaultCurrencyForCountry('GB')).toEqual({
      currencyCode: 'USD',
      currencyName: 'US Dollar',
      symbol: '$',
    });
    expect(getDefaultCurrencyForCountry(null)).toEqual({
      currencyCode: 'USD',
      currencyName: 'US Dollar',
      symbol: '$',
    });
  });
});

describe('getCurrencyDetails', () => {
  it('returns explicitly requested currency if valid', async () => {
    const { getCurrencyDetails } = await import('../organizations.controller.ts');
    expect(getCurrencyDetails('EUR')).toEqual({
      currencyCode: 'EUR',
      currencyName: 'Euro',
      symbol: '€',
    });
    expect(getCurrencyDetails('GBP')).toEqual({
      currencyCode: 'GBP',
      currencyName: 'British Pound',
      symbol: '£',
    });
  });

  it('falls back to country currency if requested code is missing or empty', async () => {
    const { getCurrencyDetails } = await import('../organizations.controller.ts');
    expect(getCurrencyDetails(null, 'IN')).toEqual({
      currencyCode: 'INR',
      currencyName: 'Indian Rupee',
      symbol: '₹',
    });
    expect(getCurrencyDetails(null, 'CA')).toEqual({
      currencyCode: 'CAD',
      currencyName: 'Canadian Dollar',
      symbol: 'CA$',
    });
  });
});
