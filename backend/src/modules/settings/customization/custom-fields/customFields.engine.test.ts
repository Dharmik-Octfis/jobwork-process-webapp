 
import { describe, it, expect } from 'vitest';
import { validateCustomFields, type FieldDefinition } from './customFields.engine.ts';
import { ApiError } from '../../../../lib/apiError.ts';

const def = (
  over: Partial<FieldDefinition> & Pick<FieldDefinition, 'key' | 'dataType'>,
): FieldDefinition => ({
  label: over.key,
  config: {},
  isRequired: false,
  ...over,
});

/** Assert the call throws a 400 ApiError whose details flag the given field key. */
function expectFieldError(fn: () => unknown, fieldKey: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(400);
    expect(apiErr.details).toHaveProperty(`customFields.${fieldKey}`);
    return;
  }
  throw new Error('expected validateCustomFields to throw');
}

describe('validateCustomFields', () => {
  it('strips keys that are not defined fields (no column poisoning)', () => {
    const defs = [def({ key: 'truck_no', dataType: 'text' })];
    const out = validateCustomFields({
      defs,
      mode: 'create',
      input: { truck_no: 'GJ-01-1234', not_a_field: 'evil' },
    });
    expect(out).toEqual({ truck_no: 'GJ-01-1234' });
    expect(out).not.toHaveProperty('not_a_field');
  });

  it('enforces required on create', () => {
    const defs = [
      def({ key: 'truck_no', dataType: 'text', isRequired: true, label: 'Truck Number' }),
    ];
    expectFieldError(() => validateCustomFields({ defs, mode: 'create', input: {} }), 'truck_no');
  });

  it('required policy (b): update leaves an old empty field editable', () => {
    const defs = [def({ key: 'truck_no', dataType: 'text', isRequired: true })];
    // Old record created before the field existed → existing has no value.
    const out = validateCustomFields({
      defs,
      mode: 'update',
      input: { other: 'x' },
      existing: {},
    });
    expect(out).toEqual({}); // no throw, nothing required to add
  });

  it('required policy (b): update DOES enforce when the field already had a value', () => {
    const defs = [def({ key: 'truck_no', dataType: 'text', isRequired: true })];
    expectFieldError(
      () =>
        validateCustomFields({
          defs,
          mode: 'update',
          input: { truck_no: '' },
          existing: { truck_no: 'GJ-01-1234' },
        }),
      'truck_no',
    );
  });

  it('preserves values of non-active (hidden/archived) fields on update', () => {
    const defs = [def({ key: 'truck_no', dataType: 'text' })];
    const out = validateCustomFields({
      defs,
      mode: 'update',
      input: { truck_no: 'NEW' },
      existing: { truck_no: 'OLD', archived_field: 'keep-me' },
    });
    expect(out).toEqual({ truck_no: 'NEW', archived_field: 'keep-me' });
  });

  it('checkbox false and number 0 are real values, not "empty"', () => {
    const defs = [
      def({ key: 'inspected', dataType: 'checkbox', isRequired: true }),
      def({ key: 'count', dataType: 'number', isRequired: true }),
    ];
    const out = validateCustomFields({
      defs,
      mode: 'create',
      input: { inspected: false, count: 0 },
    });
    expect(out).toEqual({ inspected: false, count: 0 });
  });

  it('stores decimals as strings', () => {
    const defs = [def({ key: 'amount', dataType: 'decimal' })];
    expect(validateCustomFields({ defs, mode: 'create', input: { amount: 15000.1 } })).toEqual({
      amount: '15000.1',
    });
    expect(validateCustomFields({ defs, mode: 'create', input: { amount: '250.00' } })).toEqual({
      amount: '250.00',
    });
  });

  it('rejects a select value that is not one of the option ids', () => {
    const defs = [
      def({
        key: 'priority',
        dataType: 'select',
        config: { options: [{ id: 'opt_a', label: 'Urgent' }] },
      }),
    ];
    expect(validateCustomFields({ defs, mode: 'create', input: { priority: 'opt_a' } })).toEqual({
      priority: 'opt_a',
    });
    expectFieldError(
      () => validateCustomFields({ defs, mode: 'create', input: { priority: 'Urgent' } }),
      'priority',
    );
  });

  it('caps text at 255 and multi-line text at 2000', () => {
    const defs = [
      def({ key: 'note', dataType: 'text' }),
      def({ key: 'remarks', dataType: 'textarea' }),
    ];
    expect(
      validateCustomFields({
        defs,
        mode: 'create',
        input: { note: 'a'.repeat(255), remarks: 'b'.repeat(2000) },
      }),
    ).toEqual({ note: 'a'.repeat(255), remarks: 'b'.repeat(2000) });
    expectFieldError(
      () => validateCustomFields({ defs, mode: 'create', input: { note: 'a'.repeat(256) } }),
      'note',
    );
    expectFieldError(
      () => validateCustomFields({ defs, mode: 'create', input: { remarks: 'b'.repeat(2001) } }),
      'remarks',
    );
  });

  it('ignores a maxLength left in an old definition — the type cap is the only limit', () => {
    const tight = [def({ key: 'truck_no', dataType: 'text', config: { maxLength: 17 } })];
    expect(
      validateCustomFields({ defs: tight, mode: 'create', input: { truck_no: 'x'.repeat(18) } }),
    ).toEqual({ truck_no: 'x'.repeat(18) });
    const loose = [def({ key: 'note', dataType: 'text', config: { maxLength: 5000 } })];
    expectFieldError(
      () => validateCustomFields({ defs: loose, mode: 'create', input: { note: 'x'.repeat(256) } }),
      'note',
    );
  });

  it('allows a URL longer than 255 (cap is 2048)', () => {
    const defs = [def({ key: 'link', dataType: 'url' })];
    const longUrl = `https://example.com/${'p'.repeat(300)}`;
    expect(validateCustomFields({ defs, mode: 'create', input: { link: longUrl } })).toEqual({
      link: longUrl,
    });
    expectFieldError(
      () =>
        validateCustomFields({
          defs,
          mode: 'create',
          input: { link: `https://example.com/${'p'.repeat(2048)}` },
        }),
      'link',
    );
  });

  it('validates email and rejects a bad one', () => {
    const defs = [def({ key: 'contact', dataType: 'email' })];
    expect(validateCustomFields({ defs, mode: 'create', input: { contact: 'a@b.com' } })).toEqual({
      contact: 'a@b.com',
    });
    expectFieldError(
      () => validateCustomFields({ defs, mode: 'create', input: { contact: 'nope' } }),
      'contact',
    );
  });
});
