import { describe, it, expect } from 'vitest';
import { approvalActionService } from './approvalAction.service.ts';

describe('ApprovalActionService', () => {
  it('blocks private and loopback IPs via SSRF protection', () => {
    expect(approvalActionService.isSafeWebhookUrl('http://localhost:8080/hook').safe).toBe(false);
    expect(approvalActionService.isSafeWebhookUrl('http://127.0.0.1/hook').safe).toBe(false);
    expect(approvalActionService.isSafeWebhookUrl('http://192.168.1.50/hook').safe).toBe(false);
    expect(approvalActionService.isSafeWebhookUrl('http://10.0.0.1/hook').safe).toBe(false);
    expect(approvalActionService.isSafeWebhookUrl('http://172.20.0.1/hook').safe).toBe(false);
    expect(approvalActionService.isSafeWebhookUrl('http://169.254.169.254/latest/meta-data').safe).toBe(
      false,
    );
    expect(approvalActionService.isSafeWebhookUrl('ftp://example.com/data').safe).toBe(false);

    // Public URLs allowed
    expect(approvalActionService.isSafeWebhookUrl('https://api.example.com/webhook').safe).toBe(true);
    expect(approvalActionService.isSafeWebhookUrl('https://hooks.slack.com/services/XXX').safe).toBe(true);
  });

  it('interpolates record merge tags', () => {
    const record = {
      poNumber: 'PO-2026-0042',
      totalAmount: 150000,
      vendor: { name: 'Acme Corp' },
    };

    const template =
      'Purchase order {{record.poNumber}} for {{record.vendor.name}} with amount {{record.totalAmount}} requires attention.';
    const result = approvalActionService.interpolateMergeTags(template, record);

    expect(result).toBe(
      'Purchase order PO-2026-0042 for Acme Corp with amount 150000 requires attention.',
    );
  });

  it('resolves system token values like $CURRENT_USER and $CURRENT_DATETIME', () => {
    const userVal = approvalActionService.resolveTokenValue('$CURRENT_USER', 'user-123');
    expect(userVal).toBe('user-123');

    const dtVal = approvalActionService.resolveTokenValue('$CURRENT_DATETIME');
    expect(typeof dtVal).toBe('string');
    expect(new Date(dtVal as string).getTime()).toBeGreaterThan(0);
  });
});
