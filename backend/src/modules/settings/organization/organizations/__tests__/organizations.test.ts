import { describe, it, expect } from 'vitest';
import { createOrganizationSchema } from '../organizations.schemas.ts';

describe('Organizations Schemas', () => {
  it('validates a correct payload', () => {
    const payload = {
      name: 'Acme Corp',
      portalName: 'acmecorp',
      industryCode: 'technology',
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
