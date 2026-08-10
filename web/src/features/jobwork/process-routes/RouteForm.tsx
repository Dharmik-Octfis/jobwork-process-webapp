import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { CustomFieldsSection } from '../../custom-fields/CustomFieldsSection';
import type { CustomFieldValues } from '../../custom-fields/customFields.schemas';
import { StepsGrid } from '../StepsGrid';
import { emptyStep } from '../jobwork.schemas';
import type { CreateRouteData, Route, RouteStepData } from './processRoutes.schemas';

interface Props {
  initialData?: Partial<Route>;
  onSubmit: (data: CreateRouteData) => void;
  isPending: boolean;
  onCancel: () => void;
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

const sectionHeading: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#111',
  margin: '0 0 16px 0',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

/** Turn a saved route's steps back into form rows. */
function toFormSteps(route?: Partial<Route>): RouteStepData[] {
  if (!route?.steps?.length) return [emptyStep() as RouteStepData];
  return route.steps.map((step) => ({
    processId: step.processId,
    processorType: step.processorType,
    processorId: step.processorId,
    workCentreLocationId: step.workCentreLocationId,
    rate: step.rate === null ? null : Number(step.rate),
    rateBasis: step.rateBasis,
    // 🔴 The template's bill of materials (§5.7). No quantities on either side —
    // a route has no idea how much anyone will run through it.
    inputs: step.inputs.map((row) => ({ itemId: row.itemId, uomId: row.uomId })),
    outputs: step.outputs.map((row) => ({
      itemId: row.itemId,
      uomId: row.uomId,
      isPrimary: Boolean(row.isPrimary),
    })),
    expectedYield: step.expectedYield === null ? null : Number(step.expectedYield),
    tolerancePct: step.tolerancePct === null ? null : Number(step.tolerancePct),
    remarks: step.remarks,
  }));
}

/** One form for both Create and Edit. */
export function RouteForm({ initialData, onSubmit, isPending, onCancel, fieldErrors }: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const isEdit = Boolean(initialData?.id);

  const [steps, setSteps] = useState<RouteStepData[]>(toFormSteps(initialData));
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    (initialData?.customFields as CustomFieldValues) ?? {},
  );
  const [stepError, setStepError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ name: string; code: string; description: string }>({
    defaultValues: {
      name: initialData?.name ?? '',
      code: initialData?.code ?? '',
      description: initialData?.description ?? '',
    },
  });

  const submit = (values: { name: string; code: string; description: string }) => {
    // Checked here as well as on the server: the server's message names the row,
    // but making someone round-trip to learn that step 3 has no process is worse
    // than saying so immediately.
    const missing = steps.findIndex((s) => !s.processId);
    if (missing >= 0) {
      setStepError(`Step ${missing + 1} needs a process.`);
      return;
    }
    setStepError(null);

    onSubmit({
      name: values.name.trim(),
      code: values.code?.trim() || null,
      description: values.description?.trim() || null,
      steps,
      customFields,
    });
  };

  return (
    <form
      onSubmit={handleSubmit(submit)}
      noValidate
      style={{ padding: '24px 32px', paddingBottom: 120 }}
    >
      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <div style={{ marginBottom: 20 }}>
          <label style={{ ...labelStyle, color: '#ef4444' }} htmlFor="route-name">
            Route Name*
          </label>
          <input
            id="route-name"
            type="text"
            {...register('name', { required: 'Route name is required' })}
            style={inputStyle}
            placeholder="Grey to finished fabric"
            autoFocus
          />
          {errors.name && (
            <span style={{ color: '#e54d4d', fontSize: 11, display: 'block', marginTop: 4 }}>
              {errors.name.message}
            </span>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="route-code">
            Code
          </label>
          <input
            id="route-code"
            type="text"
            {...register('code')}
            style={inputStyle}
            placeholder="GTF"
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="route-description">
            Description
          </label>
          <textarea
            id="route-description"
            {...register('description')}
            style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
            placeholder="When this sequence is used"
          />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={sectionHeading}>Steps</h2>

        {stepError && (
          <p
            style={{
              fontSize: 12,
              color: '#b91c1c',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              padding: '8px 12px',
              margin: '0 0 12px 0',
            }}
          >
            {stepError}
          </p>
        )}

        <StepsGrid steps={steps} onChange={setSteps} errors={fieldErrors} />
      </section>

      <section style={{ maxWidth: 640, marginBottom: 32 }}>
        <h2 style={sectionHeading}>Custom Fields</h2>
        <CustomFieldsSection
          orgId={orgId!}
          entityType="process_route"
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
