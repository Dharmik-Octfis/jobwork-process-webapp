/* eslint-disable @typescript-eslint/naming-convention --
   Object keys here are custom-field *data* keys, not code identifiers. `slugifyKey`
   (customFields.constants.ts) generates them as snake_case ("Truck Number" -> "truck_number"),
   so these fixtures mirror the exact shape stored in the `custom_fields` JSONB. Same category as
   the "keys we don't choose" carve-out in eslint.config.js. */
import { describe, it, expect } from 'vitest';
import { validateCustomFields, type FieldDefinition } from './customFields.engine.ts';
import { ApiError } from '../../lib/apiError.ts';

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
