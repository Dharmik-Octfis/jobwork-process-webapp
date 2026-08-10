import { blurOnWheel } from '../../../components/ui/blurOnWheel';
import { Controller, useForm } from 'react-hook-form';
import { Select } from '../../../components/ui/Select';
import { RATE_BASIS_OPTIONS, type CreateProcessData, type Process } from './processes.schemas';

export interface ProcessFormProps {
  initialData?: Partial<Process>;
  onSubmit: (data: CreateProcessData) => void;
  isPending: boolean;
  onCancel: () => void;
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

/**
 * One form, used by both Create and Edit.
 *
 * Every control here is a native `input`, `textarea`, `button` or the shared
 * `Select` — nothing is a `<div onClick>`. That is not stylistic: Tab walks
 * straight past a clickable div, so the control is simply unreachable by
 * keyboard, and neither `tsc -b` nor a screenshot says a word about it
 * (CLAUDE.md). DOM order is also tab order here — the fields are one column, so
 * the two cannot silently diverge the way they do in a multi-column grid.
 */
export function ProcessForm({ initialData, onSubmit, isPending, onCancel }: ProcessFormProps) {
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
    },
  });

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
            margin: '0 0 16px 0',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          Behaviour
        </h2>

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
        </div>

        {/*
          ⚠️ "Default Issue Unit" and "Default Receive Unit" are not asked any
          more. A step transacts in its ITEMS' stocking units (§5.1), so an
          org-wide default set here was a guess about one item — and applying it
          is what let a challan and the stock ledger describe one movement in two
          different units. The columns are gone too; see the drop migration.

          The Custom Fields section went with them: `process` left ENTITY_TYPES,
          because the operation master is a short list of names an org types once
          and per-org fields on it were a section nobody filled in.
        */}
      </section>

      <div
        style={{
          height: 44,
          boxSizing: 'border-box',
          position: 'fixed',
          bottom: 0,
          // 250, not 220: this form renders inside SettingsLayout, whose sidebar is
          // wider than the main one.
          left: 250,
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
