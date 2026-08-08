import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { Select } from '../../../components/ui/Select';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import type { CustomFieldValues } from '../../custom-fields/customFields.schemas';
import { useUoms } from '../../inventory/uom/uom.api';
import { RATE_BASIS_OPTIONS, type CreateProcessData, type Process } from './processes.schemas';

export interface ProcessFormProps {
  initialData?: Partial<Process>;
  onSubmit: (data: CreateProcessData) => void;
  isPending: boolean;
  onCancel: () => void;
  /** Server-returned per-field errors, keyed `customFields.<key>`. */
  fieldErrors?: Record<string, string>;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#111',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  minHeight: 32,
};

const errorStyle: React.CSSProperties = {
  color: '#e54d4d',
  fontSize: 11,
  display: 'block',
  marginTop: 4,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  margin: '4px 0 0 0',
  lineHeight: 1.5,
  maxWidth: 440,
};

/**
 * One form, used by both Create and Edit.
 *
 * Every control here is a native `input`, `textarea`, `button` or the shared
 * `Select` — nothing is a `<div onClick>`. That is not stylistic: Tab walks
 * straight past a clickable div, so the control is simply unreachable by
 * keyboard, and neither `tsc -b` nor a screenshot says a word about it
 * (CLAUDE.md). DOM order is also tab order here — the fields are one column, so
 * the two cannot silently diverge the way they do in a multi-column grid.
 *
 * The three checkboxes carry a line of explanation each, deliberately. "Preserves
 * packaging" is meaningless as a bare label, and getting it wrong does not
 * misprint anything today — it makes the Receive dialog offer a mode that is
 * physically impossible, months later, to someone who never saw this screen.
 */
export function ProcessForm({
  initialData,
  onSubmit,
  isPending,
  onCancel,
  fieldErrors,
}: ProcessFormProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const { data: uoms = [] } = useUoms(orgId!);

  const isEdit = Boolean(initialData?.id);

  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    (initialData?.customFields as CustomFieldValues) ?? {},
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateProcessData>({
    defaultValues: {
      name: initialData?.name ?? '',
      code: initialData?.code ?? '',
      description: initialData?.description ?? '',
      itemChanges: initialData?.itemChanges ?? false,
      rateBasis: initialData?.rateBasis ?? 'per_issued_unit',
      defaultTolerancePct:
        initialData?.defaultTolerancePct === null || initialData?.defaultTolerancePct === undefined
          ? null
          : Number(initialData.defaultTolerancePct),
      defaultIssueUomId: initialData?.defaultIssueUomId ?? null,
      defaultReceiveUomId: initialData?.defaultReceiveUomId ?? null,
      isActive: initialData?.isActive ?? true,
    },
  });

  const uomOptions = [
    { value: '', label: 'None' },
    ...uoms.map((u) => ({ value: u.id, label: `${u.unitName} (${u.symbol})` })),
  ];

  const submit = (data: CreateProcessData) => {
    onSubmit({
      ...data,
      code: data.code?.trim() || null,
      description: data.description?.trim() || null,
      // An empty tolerance is null, not 0 — "no default" and "no tolerance at
      // all" are different answers, and 0 would silently block every receipt
      // that is a gram over.
      defaultTolerancePct:
        data.defaultTolerancePct === null ||
        data.defaultTolerancePct === undefined ||
        Number.isNaN(data.defaultTolerancePct)
          ? null
          : Number(data.defaultTolerancePct),
      defaultIssueUomId: data.defaultIssueUomId || null,
      defaultReceiveUomId: data.defaultReceiveUomId || null,
      customFields,
    });
  };

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      style={{ padding: '24px 32px', paddingBottom: 200 }}
    >
      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, color: '#ef4444' }} htmlFor="process-name">
            Process Name*
          </label>
          <input
            id="process-name"
            type="text"
            {...register('name', { required: 'Process name is required' })}
            style={inputStyle}
            placeholder="Dyeing"
            autoFocus
          />
          {errors.name && <span style={errorStyle}>{errors.name.message}</span>}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-code">
            Code
          </label>
          <input
            id="process-code"
            type="text"
            {...register('code')}
            style={inputStyle}
            placeholder="DYE"
          />
          <p style={hintStyle}>Optional short code for paperwork. Nothing is derived from it.</p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-description">
            Description
          </label>
          <textarea
            id="process-description"
            {...register('description')}
            style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
            placeholder="What this operation does to the material"
          />
        </div>
      </section>

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#111',
            margin: '0 0 4px 0',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Behaviour
        </h2>
        <p style={{ ...hintStyle, maxWidth: 560, marginBottom: 16 }}>
          These decide what the Issue and Receive screens are allowed to offer. They are facts about
          the operation, not preferences.
        </p>

        <label
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            marginBottom: 16,
            cursor: 'pointer',
          }}
        >
          <input type="checkbox" {...register('itemChanges')} style={{ marginTop: 3 }} />
          <span>
            <strong style={{ fontSize: 13, color: '#111' }}>The item changes</strong>
            <p style={{ ...hintStyle, marginTop: 2 }}>
              What comes back is a different item from what went out — cloth in, shirt out. Leave
              this off for dyeing or printing, where the same item returns.
            </p>
          </span>
        </label>

        {/*
          ⚠️ "Packaging survives" and "One lot per issue" are not asked any more.
          Both drove taka-level behaviour: the first chose taka-wise vs bulk
          receiving, the second blocked mixing lots on one challan. Issue and
          receive are both LOT level now, so neither changed anything a user
          could see — and a checkbox that changes nothing is worse than a missing
          one, because people set it and believe it did something.

          The columns and the server-side single-lot guard are untouched, so
          bringing the pair back is this block plus the two switches named in
          `jobReceipts.service.ts` and the web `LotPicker`.
        */}
      </section>

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#111',
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Defaults
        </h2>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-rate-basis">
            Rate Basis
          </label>
          <Controller
            name="rateBasis"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ?? 'per_issued_unit'}
                onChange={field.onChange}
                options={[...RATE_BASIS_OPTIONS]}
                ariaLabel="Rate basis"
                fullWidth={false}
                minWidth={440}
              />
            )}
          />
          <p style={hintStyle}>
            Which quantity the processor's rate multiplies. 4,850 m received against 5,000 m issued
            is a different bill depending on this.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="process-tolerance">
            Default Tolerance %
          </label>
          <input
            id="process-tolerance"
            type="number"
            onWheel={blurOnWheel}
            step="0.001"
            min="0"
            max="100"
            {...register('defaultTolerancePct', {
              setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              min: { value: 0, message: 'Tolerance cannot be negative' },
              max: { value: 100, message: 'Tolerance cannot exceed 100%' },
            })}
            style={inputStyle}
            placeholder="Leave blank for no default"
          />
          {errors.defaultTolerancePct && (
            <span style={errorStyle}>{errors.defaultTolerancePct.message}</span>
          )}
          <p style={hintStyle}>
            Blank means no default. Zero means no tolerance at all — a receipt a gram over plan is
            blocked.
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Default Issue Unit</label>
          <Controller
            name="defaultIssueUomId"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v || null)}
                options={uomOptions}
                ariaLabel="Default issue unit"
                fullWidth={false}
                minWidth={440}
              />
            )}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Default Receive Unit</label>
          <Controller
            name="defaultReceiveUomId"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value ?? ''}
                onChange={(v) => field.onChange(v || null)}
                options={uomOptions}
                ariaLabel="Default receive unit"
                fullWidth={false}
                minWidth={440}
              />
            )}
          />
          <p style={hintStyle}>
            Two units, not one: what goes out and what comes back can be measured differently. This
            is a default a route step copies, never a conversion factor.
          </p>
        </div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" {...register('isActive')} />
          <span style={{ fontSize: 13, color: '#111' }}>Active</span>
        </label>
      </section>

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#111',
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Custom Fields
        </h2>
        <CustomFieldsSection
          orgId={orgId!}
          entityType="process"
          values={customFields}
          onChange={setCustomFields}
          errors={fieldErrors}
          applyDefaults={!isEdit}
        />
      </section>

      <div
        style={{
          height: 44,
          boxSizing: 'border-box',
          position: 'fixed',
          bottom: 0,
          left: 220,
          right: 0,
          background: '#fff',
          padding: '0 24px',
          borderTop: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 100,
        }}
      >
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: '6px 20px',
            background: '#0062ff',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '6px 20px',
            background: 'white',
            color: '#333',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
