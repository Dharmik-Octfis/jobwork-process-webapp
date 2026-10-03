import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from '../../../config/env.ts';
import { encryptToken, decryptToken } from '../../../lib/encryption.ts';
import {
  resolveAccountsServer,
  saveZohoCredentials,
  buildAuthorizationUrl,
  handleCallback,
  getSafeIntegrationStatus,
  disconnectIntegration,
} from './zoho.oauth.service.ts';
import { getValidAccessToken } from './zoho.token.service.ts';
import {
  fetchZohoOrganizations,
  saveSelectedZohoOrganization,
} from './zoho.api.service.ts';
import {
  ZOHO_INTEGRATION_STATUS,
  ZOHO_DEFAULT_ACCOUNTS_URL,
  ZOHO_DATA_CENTERS,
} from './zoho.constants.ts';
import { prisma } from '../../../db/prisma.ts';
import { ApiError } from '../../../lib/apiError.ts';

describe('Zoho Books Integration Module', () => {
  const testOrgId = '00000000-0000-0000-0000-000000000001';
  const testOrgIdB = '00000000-0000-0000-0000-000000000009';
  const testUserId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock prisma.$transaction so runAsTenant delegates tx calls directly to prisma mock
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') {
        const mockTx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          zohoIntegration: prisma.zohoIntegration,
          oAuthState: prisma.oAuthState,
        };
        return cb(mockTx);
      }
      return cb;
    });
  });

  describe('1. Token & Credential Encryption (AES-256-GCM)', () => {
    it('encrypts and decrypts token/secret correctly', () => {
      const plainSecret = 'zoho_client_secret_987654321';
      const cipherText = encryptToken(plainSecret);

      expect(cipherText).not.toBe(plainSecret);
      expect(cipherText.split(':')).toHaveLength(3); // iv:authTag:encryptedData

      const decrypted = decryptToken(cipherText);
      expect(decrypted).toBe(plainSecret);
    });

    it('handles empty string gracefully', () => {
      expect(encryptToken('')).toBe('');
      expect(decryptToken('')).toBe('');
    });
  });

  describe('2. Multi-Data-Center & Accounts Server Resolution', () => {
    it('resolves default accounts server when no override or location is given', () => {
      const server = resolveAccountsServer(null, null);
      expect(server).toBe(env.zoho.accountsUrl || ZOHO_DEFAULT_ACCOUNTS_URL);
    });

    it('resolves India DC accounts server from location param', () => {
      const server = resolveAccountsServer(null, 'IN');
      expect(server).toBe(ZOHO_DATA_CENTERS.IN.accountsUrl);
    });

    it('resolves Europe DC accounts server from location param', () => {
      const server = resolveAccountsServer(null, 'EU');
      expect(server).toBe(ZOHO_DATA_CENTERS.EU.accountsUrl);
    });

    it('resolves explicit custom accounts server override when provided', () => {
      const server = resolveAccountsServer('https://accounts.zoho.eu/', null);
      expect(server).toBe('https://accounts.zoho.eu');
    });
  });

  describe('3. Credential Configuration & Masking', () => {
    it('saves organization-specific client credentials with encrypted secret', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue(null);
      const createSpy = vi.spyOn(prisma.zohoIntegration, 'create').mockResolvedValue({} as any);

      await saveZohoCredentials(
        testOrgId,
        '1000.TESTCLIENTID',
        'raw_secret_xyz123',
        testUserId,
      );

      expect(createSpy).toHaveBeenCalled();
      const callData = createSpy.mock.calls[0][0].data;
      expect(callData.organizationId).toBe(testOrgId);
      expect(callData.clientId).toBe('1000.TESTCLIENTID');
      expect(callData.clientSecret).not.toBe('raw_secret_xyz123');
      expect(decryptToken(callData.clientSecret)).toBe('raw_secret_xyz123');
    });

    it('returns masked client secret and never leaks the plain secret in getSafeIntegrationStatus', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('super_confidential_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONFIGURED,
        accessToken: null,
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
        apiDomain: null,
        accountsServer: null,
        zohoLocation: null,
        selectedOrganizationId: null,
        selectedOrganizationName: null,
        connectedAt: null,
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const status = await getSafeIntegrationStatus(testOrgId);

      expect(status.isConfigured).toBe(true);
      expect(status.hasClientSecret).toBe(true);
      expect(status.maskedClientSecret).toBe('••••••••••••');
      expect(status.clientId).toBe('1000.TESTCLIENTID');
      expect((status as any).clientSecret).toBeUndefined();
      expect((status as any).accessToken).toBeUndefined();
      expect((status as any).refreshToken).toBeUndefined();
    });
  });

  describe('4. Authorization URL & Secure State Generation', () => {
    it('generates secure random state and builds valid authorization URL', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
      } as any);

      vi.spyOn(prisma.oAuthState, 'deleteMany').mockResolvedValue({ count: 0 });
      vi.spyOn(prisma.oAuthState, 'create').mockImplementation(async (args: any) => ({
        id: 'state-id-1',
        createdAt: new Date(),
        ...args.data,
      }));

      const result = await buildAuthorizationUrl(testOrgId, testUserId);

      expect(result.url).toBeDefined();
      expect(result.state).toBeDefined();
      expect(result.state.length).toBe(64); // 32 bytes hex = 64 chars

      const parsedUrl = new URL(result.url);
      expect(parsedUrl.searchParams.get('response_type')).toBe('code');
      expect(parsedUrl.searchParams.get('access_type')).toBe('offline');
      expect(parsedUrl.searchParams.get('prompt')).toBe('consent');
      expect(parsedUrl.searchParams.get('state')).toBe(result.state);
      expect(parsedUrl.searchParams.get('scope')).toBe(env.zoho.scopes || ZOHO_DEFAULT_SCOPE);
    });

    it('throws error if organization has not configured Client ID or Client Secret', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue(null);

      // In case env credentials are also empty, it must throw
      const origEnvClientId = env.zoho.clientId;
      const origEnvClientSecret = env.zoho.clientSecret;
      (env.zoho as any).clientId = '';
      (env.zoho as any).clientSecret = '';

      try {
        await expect(buildAuthorizationUrl(testOrgId, testUserId)).rejects.toThrow(
          /Zoho Client ID and Client Secret are not configured/i,
        );
      } finally {
        (env.zoho as any).clientId = origEnvClientId;
        (env.zoho as any).clientSecret = origEnvClientSecret;
      }
    });
  });

  describe('5. OAuth Callback & State Validation', () => {
    it('rejects callback with missing code or state', async () => {
      await expect(handleCallback('', 'state123')).rejects.toThrow(ApiError);
      await expect(handleCallback('code123', '')).rejects.toThrow(ApiError);
    });

    it('rejects callback with invalid or non-existent state', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue(null);

      await expect(handleCallback('valid_code', 'invalid_state')).rejects.toThrow(
        /Unable to verify the Zoho authorization request/i,
      );
    });

    it('rejects callback with expired state', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue({
        id: 'expired-state-id',
        state: 'expired_state',
        organizationId: testOrgId,
        userId: testUserId,
        provider: 'ZOHO_BOOKS',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        returnTo: null,
        expiresAt: new Date(Date.now() - 60000), // Expired 1 min ago
        usedAt: null,
        createdAt: new Date(),
      });

      await expect(handleCallback('valid_code', 'expired_state')).rejects.toThrow(
        /Unable to verify the Zoho authorization request. The session has expired/i,
      );
    });

    it('rejects callback with already used state', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue({
        id: 'used-state-id',
        state: 'reused_state',
        organizationId: testOrgId,
        userId: testUserId,
        provider: 'ZOHO_BOOKS',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        returnTo: null,
        expiresAt: new Date(Date.now() + 600000),
        usedAt: new Date(), // Already used!
        createdAt: new Date(),
      });

      await expect(handleCallback('valid_code', 'reused_state')).rejects.toThrow(
        /The session has expired, is invalid, or was already used/i,
      );
    });

    it('exchanges authorization code for tokens, encrypts, and persists integration on success', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue({
        id: 'valid-state-id',
        state: 'valid_state',
        organizationId: testOrgId,
        userId: testUserId,
        provider: 'ZOHO_BOOKS',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        returnTo: '/settings/integrations/zoho',
        expiresAt: new Date(Date.now() + 600000),
        usedAt: null,
        createdAt: new Date(),
      });
      vi.spyOn(prisma.oAuthState, 'update').mockResolvedValue({} as any);

      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
      } as any);

      const mockTokenResponse = {
        access_token: 'zoho_access_token_123',
        refresh_token: 'zoho_refresh_token_456',
        api_domain: 'https://www.zohoapis.in',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse,
      } as Response);

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      const result = await handleCallback('auth_code_123', 'valid_state', undefined, 'IN');

      expect(result.organizationId).toBe(testOrgId);
      expect(updateSpy).toHaveBeenCalled();
      const savedData = updateSpy.mock.calls[0][0].data;

      expect(savedData.status).toBe(ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION);
      expect(savedData.apiDomain).toBe('https://www.zohoapis.in');
      expect(decryptToken(savedData.accessToken!)).toBe('zoho_access_token_123');
      expect(decryptToken(savedData.refreshToken!)).toBe('zoho_refresh_token_456');
    });

    it('handles token exchange failure (e.g. invalid_code)', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue({
        id: 'valid-state-id',
        state: 'valid_state',
        organizationId: testOrgId,
        userId: testUserId,
        provider: 'ZOHO_BOOKS',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        returnTo: null,
        expiresAt: new Date(Date.now() + 600000),
        usedAt: null,
        createdAt: new Date(),
      });
      vi.spyOn(prisma.oAuthState, 'update').mockResolvedValue({} as any);

      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
      } as any);

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'invalid_code',
          error_description: 'Authorization code has expired',
        }),
      } as Response);

      await expect(handleCallback('expired_code', 'valid_state')).rejects.toThrow(
        /Zoho authorization code expired/i,
      );
    });
  });

  describe('6. Access Token Refresh Logic (zoho.token.service)', () => {
    it('returns existing access token when still valid without calling Zoho API', async () => {
      const plainAccessToken = 'valid_active_token';
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        accessToken: encryptToken(plainAccessToken),
        refreshToken: encryptToken('refresh_token_xyz'),
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1800000), // Valid for 30 minutes
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        connectedAt: new Date(),
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = await getValidAccessToken(testOrgId);

      expect(result.accessToken).toBe(plainAccessToken);
      expect(result.apiDomain).toBe('https://www.zohoapis.com');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refreshes access token automatically when expired or near expiry', async () => {
      const newAccessToken = 'new_refreshed_access_token';
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        accessToken: encryptToken('old_expired_token'),
        refreshToken: encryptToken('valid_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() - 60000), // Expired
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        connectedAt: new Date(),
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: newAccessToken,
          expires_in: 3600,
          api_domain: 'https://www.zohoapis.com',
        }),
      } as Response);

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      const result = await getValidAccessToken(testOrgId);

      expect(result.accessToken).toBe(newAccessToken);
      expect(updateSpy).toHaveBeenCalled();
    });

    it('throws 401 when refresh token is revoked or invalid and sets status to TOKEN_EXPIRED', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        accessToken: null,
        refreshToken: encryptToken('revoked_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: null,
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        connectedAt: null,
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          error: 'invalid_token',
          error_description: 'Refresh token is revoked',
        }),
      } as Response);

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      await expect(getValidAccessToken(testOrgId)).rejects.toThrow(
        /Zoho authorization has expired or was revoked/i,
      );
      expect(updateSpy).toHaveBeenCalledWith({
        where: { organizationId: testOrgId },
        data: { status: ZOHO_INTEGRATION_STATUS.TOKEN_EXPIRED },
      });
    });
  });

  describe('7. Zoho Organizations API & Selection', () => {
    it('fetches sanitized organization list from Zoho Books API', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
        accessToken: encryptToken('valid_access_token'),
        refreshToken: encryptToken('valid_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1800000),
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: null,
        selectedOrganizationName: null,
        connectedAt: null,
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const mockOrgsResponse = {
        code: 0,
        message: 'success',
        organizations: [
          {
            organization_id: '10229182',
            name: 'ABC Manufacturing',
            is_default_org: true,
            currency_code: 'INR',
            currency_symbol: '₹',
          },
          {
            organization_id: '10229183',
            name: 'XYZ Global Inc',
            is_default_org: false,
            currency_code: 'USD',
            currency_symbol: '$',
          },
        ],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => mockOrgsResponse,
      } as Response);

      const orgs = await fetchZohoOrganizations(testOrgId);

      expect(orgs).toHaveLength(2);
      expect(orgs[0]).toEqual({
        organization_id: '10229182',
        name: 'ABC Manufacturing',
        is_default_org: true,
        currency_code: 'INR',
        currency_symbol: '₹',
        language_code: undefined,
        time_zone: undefined,
        is_org_active: true,
        country: undefined,
      });
    });

    it('validates and saves selected organization, setting status to CONNECTED', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
        accessToken: encryptToken('valid_access_token'),
        refreshToken: encryptToken('valid_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1800000),
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: null,
        selectedOrganizationName: null,
        connectedAt: null,
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          organizations: [{ organization_id: '10229182', name: 'ABC Manufacturing' }],
        }),
      } as Response);

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      const result = await saveSelectedZohoOrganization(testOrgId, '10229182', testUserId);

      expect(result.selectedOrganizationId).toBe('10229182');
      expect(result.selectedOrganizationName).toBe('ABC Manufacturing');
      expect(updateSpy).toHaveBeenCalledWith({
        where: { organizationId: testOrgId },
        data: expect.objectContaining({
          selectedOrganizationId: '10229182',
          selectedOrganizationName: 'ABC Manufacturing',
          status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        }),
      });
    });

    it('rejects saving an organization ID not returned by Zoho', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.PENDING_ORGANIZATION_SELECTION,
        accessToken: encryptToken('valid_access_token'),
        refreshToken: encryptToken('valid_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1800000),
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: null,
        selectedOrganizationName: null,
        connectedAt: null,
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          organizations: [{ organization_id: '10229182', name: 'ABC Manufacturing' }],
        }),
      } as Response);

      await expect(
        saveSelectedZohoOrganization(testOrgId, '99999999', testUserId),
      ).rejects.toThrow(/Selected organization is not valid/i);
    });
  });

  describe('8. Disconnect Flow & Safe Status', () => {
    it('disconnects integration by clearing tokens while preserving configured credentials', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('test_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        accessToken: encryptToken('access_token_123'),
        refreshToken: encryptToken('refresh_token_123'),
        tokenType: 'Bearer',
        expiresAt: new Date(),
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: null,
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        connectedAt: new Date(),
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      await disconnectIntegration(testOrgId, testUserId);

      expect(updateSpy).toHaveBeenCalledWith({
        where: { organizationId: testOrgId },
        data: expect.objectContaining({
          status: ZOHO_INTEGRATION_STATUS.DISCONNECTED,
          refreshToken: null,
          accessToken: null,
          selectedOrganizationId: null,
          selectedOrganizationName: null,
          connectedAt: null,
        }),
      });
    });

    it('returns safe status object with zero sensitive token properties', async () => {
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockResolvedValue({
        id: 'int-1',
        organizationId: testOrgId,
        provider: 'ZOHO_BOOKS',
        clientId: '1000.TESTCLIENTID',
        clientSecret: encryptToken('super_secret_client_secret'),
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        accessToken: encryptToken('super_secret_access_token'),
        refreshToken: encryptToken('super_secret_refresh_token'),
        tokenType: 'Bearer',
        expiresAt: new Date(),
        apiDomain: 'https://www.zohoapis.com',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        zohoLocation: 'US',
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        connectedAt: new Date('2026-09-30T10:00:00Z'),
        isDeleted: false,
        createdBy: testUserId,
        updatedBy: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const status = await getSafeIntegrationStatus(testOrgId);

      expect(status).toEqual({
        isConnected: true,
        isAuthorized: true,
        isConfigured: true,
        clientId: '1000.TESTCLIENTID',
        hasClientSecret: true,
        maskedClientSecret: '••••••••••••',
        status: ZOHO_INTEGRATION_STATUS.CONNECTED,
        connectedAt: '2026-09-30T10:00:00.000Z',
        selectedOrganizationId: '10229182',
        selectedOrganizationName: 'ABC Manufacturing',
        apiDomain: 'https://www.zohoapis.com',
        zohoLocation: 'US',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
      });

      // Assert that tokens and raw secrets are never exposed
      expect((status as any).accessToken).toBeUndefined();
      expect((status as any).refreshToken).toBeUndefined();
      expect((status as any).clientSecret).toBeUndefined();
    });
  });

  describe('9. Multi-Tenant Isolation Guarantees', () => {
    it('ensures Organization A credentials and state are completely separated from Organization B', async () => {
      // Setup mock where Org A has credentials and Org B has nothing
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockImplementation(async (args: any) => {
        if (args.where.organizationId === testOrgId) {
          return {
            id: 'int-org-a',
            organizationId: testOrgId,
            provider: 'ZOHO_BOOKS',
            clientId: 'ORG_A_CLIENT_ID',
            clientSecret: encryptToken('ORG_A_SECRET'),
            status: ZOHO_INTEGRATION_STATUS.CONNECTED,
            accessToken: encryptToken('org_a_access_token'),
            refreshToken: encryptToken('org_a_refresh_token'),
            tokenType: 'Bearer',
            expiresAt: new Date(Date.now() + 1800000),
            apiDomain: 'https://www.zohoapis.in',
            accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
            zohoLocation: 'IN',
            selectedOrganizationId: 'ZOHO_ORG_A',
            selectedOrganizationName: 'Org A Zoho Entity',
            connectedAt: new Date(),
            isDeleted: false,
          } as any;
        }

        if (args.where.organizationId === testOrgIdB) {
          return null;
        }
        return null;
      });

      const statusA = await getSafeIntegrationStatus(testOrgId);
      const statusB = await getSafeIntegrationStatus(testOrgIdB);

      expect(statusA.isConnected).toBe(true);
      expect(statusA.clientId).toBe('ORG_A_CLIENT_ID');
      expect(statusA.selectedOrganizationId).toBe('ZOHO_ORG_A');

      expect(statusB.isConnected).toBe(false);
      expect(statusB.clientId).toBeNull();
      expect(statusB.selectedOrganizationId).toBeNull();
    });

    it('OAuth state cannot be used by a mismatched organization', async () => {
      vi.spyOn(prisma.oAuthState, 'findUnique').mockResolvedValue({
        id: 'state-org-a',
        state: 'valid_state_org_a',
        organizationId: testOrgId, // Belongs to Org A
        userId: testUserId,
        provider: 'ZOHO_BOOKS',
        accountsServer: ZOHO_DEFAULT_ACCOUNTS_URL,
        returnTo: null,
        expiresAt: new Date(Date.now() + 600000),
        usedAt: null,
        createdAt: new Date(),
      });

      vi.spyOn(prisma.oAuthState, 'update').mockResolvedValue({} as any);

      // In handleCallback, it loads the integration for the organization recorded on state
      vi.spyOn(prisma.zohoIntegration, 'findUnique').mockImplementation(async (args: any) => {
        if (args.where.organizationId === testOrgId) {
          return {
            id: 'int-org-a',
            organizationId: testOrgId,
            clientId: 'ORG_A_CLIENT_ID',
            clientSecret: encryptToken('ORG_A_SECRET'),
          } as any;
        }
        return null;
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_token',
          refresh_token: 'new_refresh',
          expires_in: 3600,
        }),
      } as Response);

      const updateSpy = vi.spyOn(prisma.zohoIntegration, 'update').mockResolvedValue({} as any);

      const result = await handleCallback('code123', 'valid_state_org_a');

      // Verifies that the tenant ID comes strictly from the stored OAuth state
      expect(result.organizationId).toBe(testOrgId);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { organizationId: testOrgId },
        data: expect.anything(),
      });
    });
  });
});
