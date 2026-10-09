/**
 * Zoho Books Integration Constants
 */

export const ZOHO_PROVIDER = 'ZOHO_BOOKS';

export const ZOHO_DEFAULT_ACCOUNTS_URL = 'https://accounts.zoho.com';
export const ZOHO_DEFAULT_API_DOMAIN = 'https://www.zohoapis.com';
export const ZOHO_DEFAULT_SCOPE = 'ZohoBooks.settings.READ';

export const ZOHO_INTEGRATION_STATUS = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  CONFIGURED: 'CONFIGURED',
  AUTHORIZING: 'AUTHORIZING',
  PENDING_ORGANIZATION_SELECTION: 'PENDING_ORGANIZATION_SELECTION',
  AUTHORIZED: 'AUTHORIZED',
  CONNECTED: 'CONNECTED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
} as const;

export type ZohoIntegrationStatus = (typeof ZOHO_INTEGRATION_STATUS)[keyof typeof ZOHO_INTEGRATION_STATUS];

/**
 * Supported Zoho Data Centers and their Accounts / API endpoints
 */
export const ZOHO_DATA_CENTERS: Record<string, { accountsUrl: string; apiDomain: string; label: string }> = {
  US: {
    accountsUrl: 'https://accounts.zoho.com',
    apiDomain: 'https://www.zohoapis.com',
    label: 'United States (.com)',
  },
  IN: {
    accountsUrl: 'https://accounts.zoho.in',
    apiDomain: 'https://www.zohoapis.in',
    label: 'India (.in)',
  },
  EU: {
    accountsUrl: 'https://accounts.zoho.eu',
    apiDomain: 'https://www.zohoapis.eu',
    label: 'Europe (.eu)',
  },
  AU: {
    accountsUrl: 'https://accounts.zoho.com.au',
    apiDomain: 'https://www.zohoapis.com.au',
    label: 'Australia (.com.au)',
  },
  JP: {
    accountsUrl: 'https://accounts.zoho.jp',
    apiDomain: 'https://www.zohoapis.jp',
    label: 'Japan (.jp)',
  },
  CA: {
    accountsUrl: 'https://accounts.zohocloud.ca',
    apiDomain: 'https://www.zohoapis.ca',
    label: 'Canada (.ca)',
  },
  SA: {
    accountsUrl: 'https://accounts.zoho.sa',
    apiDomain: 'https://www.zohoapis.sa',
    label: 'Saudi Arabia (.sa)',
  },
  CN: {
    accountsUrl: 'https://accounts.zoho.com.cn',
    apiDomain: 'https://www.zohoapis.com.cn',
    label: 'China (.com.cn)',
  },
};
