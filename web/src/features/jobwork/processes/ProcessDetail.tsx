import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchProcessById } from './processes.api';
import { rateBasisLabel } from './processes.schemas';

interface Props {
  processId: string;
  onClose: () => void;
}

const rowLabel: React.CSSProperties = { fontSize: 12, color: '#64748b', paddingRight: 16 };
const rowValue: React.CSSProperties = { fontSize: 13, color: '#111' };

/** A yes/no that reads as a sentence, because the flags are consequences, not
 * attributes — "Yes" beside "Preserves packaging" tells a reader nothing. */
function Flag({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return <span style={rowValue}>{on ? yes : no}</span>;
}

export function ProcessDetail({ processId, onClose }: Props) {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();

  const { data: process, isLoading } = useQuery({
    queryKey: ['process', orgId, processId],
    queryFn: () => fetchProcessById(orgId!, processId),
    enabled: Boolean(orgId && processId),
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading process" />
      </div>
    );
  }

  if (!process) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Process not found.</div>;
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
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}>
            {process.name}
          </h2>
          {process.code && <span style={{ fontSize: 12, color: '#64748b' }}>{process.code}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() =>
              navigate(`/organizations/${orgId}/settings/jobwork/processes/${process.id}/edit`)
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
        {process.description && (
          <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6, margin: '0 0 20px 0' }}>
            {process.description}
          </p>
        )}

        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={rowLabel}>Rate basis</td>
              <td style={{ padding: '6px 0', ...rowValue }}>{rateBasisLabel(process.rateBasis)}</td>
            </tr>
            <tr>
              <td style={rowLabel}>Output item</td>
              <td style={{ padding: '6px 0' }}>
                <Flag
                  on={process.itemChanges}
                  yes="Different item comes back"
                  no="Same item comes back"
                />
              </td>
            </tr>
            {/* Receipt mode and lot mixing are not shown: both described
                taka-level behaviour, and issue and receive are lot level now. */}
            <tr>
              <td style={rowLabel}>Default tolerance</td>
              <td style={{ padding: '6px 0', ...rowValue }}>
                {process.defaultTolerancePct === null
                  ? 'No default'
                  : `${process.defaultTolerancePct}%`}
              </td>
            </tr>
            {/* Default issue/receive unit are not shown: a step transacts in its
                items' stocking units, so an org-wide default here was a guess
                about one item. Custom fields went with them — `process` is no
                longer a custom-field module. */}
          </tbody>
        </table>
      </div>
    </div>
  );
}
