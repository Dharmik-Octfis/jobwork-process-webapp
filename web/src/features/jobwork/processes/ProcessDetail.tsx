import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { Pencil, X } from 'lucide-react';
import { Spinner } from '../../../components/ui/Spinner';
import { fetchProcessById } from './processes.api';

interface Props {
  processId: string;
  onClose: () => void;
}

export function ProcessDetail({ processId, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
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
      <header className="detail-page-header">
        <div>
          <h2
            className="detail-title"
            style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}
          >
            {process.name}
          </h2>
          {process.code && <span style={{ fontSize: 12, color: '#64748b' }}>{process.code}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="action-btn"
            type="button"
            onClick={() =>
              navigate(`/organizations/${orgId}/settings/jobwork/processes/${process.id}/edit`, {
                state: { returnUrl: location.pathname + location.search },
              })
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
            <Pencil size={14} /> <span className="action-btn-text">Edit</span>
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

      {/* A process carries no flags any more (itemChanges went 2026-09-30), so
        the name, code and description are the whole record. */}
      <div style={{ padding: '20px 24px' }}>
        {process.description ? (
          <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6, margin: 0 }}>
            {process.description}
          </p>
        ) : (
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>No description.</p>
        )}
      </div>
    </div>
  );
}
