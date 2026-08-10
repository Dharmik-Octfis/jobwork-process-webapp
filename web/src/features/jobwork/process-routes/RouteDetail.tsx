import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { useActiveCustomFields } from '../../custom-fields/customFields.api';
import { rateBasisLabel } from '../processes/processes.schemas';
import { formatQty, processorTypeLabel, type StepItemRowRead } from '../jobwork.schemas';
import { fetchRouteById } from './processRoutes.api';

interface Props {
  routeId: string;
  onClose: () => void;
}

/** One label → value line, the shape the Item detail reads in. */
/** One list of a step's items, one per line. `Main` marks the output that will
 * carry the step's cost when a job order runs this template (§9.2.1). */
function ItemLines({ rows }: { rows: StepItemRowRead[] }) {
  return (
    <span>
      {rows.map((row) => (
        <span key={row.id} style={{ display: 'block' }}>
          {row.item?.name ?? 'Item'}
          {row.uom ? ` (${row.uom.symbol ?? row.uom.unitName})` : ''}
          {row.isPrimary && (
            <span style={{ marginLeft: 6, fontSize: 11, color: '#047857' }}>Main</span>
          )}
        </span>
      ))}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, alignItems: 'start' }}
    >
      <span style={{ fontSize: 12, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 13, color: '#1e293b' }}>{children}</span>
    </div>
  );
}

export function RouteDetail({ routeId, onClose }: Props) {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();

  const { data: route, isLoading } = useQuery({
    queryKey: ['route', orgId, routeId],
    queryFn: () => fetchRouteById(orgId!, routeId),
    enabled: Boolean(orgId && routeId),
  });

  const { data: customFieldDefs = [] } = useActiveCustomFields(orgId!, 'process_route');

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading route" />
      </div>
    );
  }

  if (!route) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Route not found.</div>;
  }

  return (
    <div style={{ background: '#fff', minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}>{route.name}</h2>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {route.code ? `${route.code} · ` : ''}
            {route.steps.length} step{route.steps.length === 1 ? '' : 's'} ·{' '}
            {route.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() =>
              navigate(`/organizations/${orgId}/settings/jobwork/routes/${route.id}/edit`)
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
              color: '#333',
            }}
          >
            <Pencil size={14} /> Edit
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div style={{ padding: '20px 24px' }}>
        {route.description && (
          <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6, margin: '0 0 20px 0' }}>
            {route.description}
          </p>
        )}

        {/* One block per step, not a table row. Seven columns of route detail
            never fitted the pane, so the widths fought each other and the tail of
            each row sat off-screen. Down the page each value gets its own line and
            nothing scrolls sideways — the shape the Item detail reads in. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {route.steps.map((step) => (
            <div
              key={step.id}
              style={{ border: '1px solid #eef0f3', borderRadius: 6, overflow: 'hidden' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  padding: '8px 14px',
                  background: '#f9f9fb',
                  borderBottom: '1px solid #eef0f3',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>
                  Step {step.seq}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
                  {step.process?.name ?? '-'}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
                <Row label="Done by">
                  {processorTypeLabel(step.processorType)}
                  {step.workCentre && (
                    <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                      {step.workCentre.name}
                    </span>
                  )}
                </Row>
                {/* 🔴 A step consumes a SET and produces a SET (§5.7). The unit
                    is shown beside every item because a changed unit IS a
                    changed item here — never a conversion factor. */}
                <Row label="Consumes">
                  {step.inputs.length === 0 ? (
                    'From previous step'
                  ) : (
                    <ItemLines rows={step.inputs} />
                  )}
                </Row>
                <Row label="Produces">
                  {step.outputs.length === 0 ? 'Unchanged' : <ItemLines rows={step.outputs} />}
                </Row>
                <Row label="Rate">
                  {step.rate === null ? '-' : formatQty(step.rate)}
                  {step.rateBasis && (
                    <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                      {rateBasisLabel(step.rateBasis)}
                    </span>
                  )}
                </Row>
                <Row label="Yield">
                  {step.expectedYield === null ? '-' : formatQty(step.expectedYield)}
                </Row>
                <Row label="Tolerance">
                  {step.tolerancePct === null ? '-' : `${formatQty(step.tolerancePct)}%`}
                </Row>
                {step.remarks && <Row label="Remarks">{step.remarks}</Row>}
              </div>
            </div>
          ))}
        </div>

        {customFieldDefs.length > 0 && (
          <table style={{ borderCollapse: 'collapse', marginTop: 20 }}>
            <tbody>
              {customFieldDefs.map((def) => {
                const value = route.customFields?.[def.key];
                return (
                  <tr key={def.id}>
                    <td style={{ fontSize: 12, color: '#64748b', paddingRight: 16 }}>
                      {def.label}
                    </td>
                    <td style={{ padding: '6px 0', fontSize: 13, color: '#111' }}>
                      {value === null || value === undefined || value === ''
                        ? '-'
                        : Array.isArray(value)
                          ? value.join(', ')
                          : String(value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
