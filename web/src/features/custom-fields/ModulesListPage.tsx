import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, LayoutGrid } from 'lucide-react';
import { CUSTOM_FIELD_MODULES } from './customFields.schemas';

/** Settings → Modules: pick a module to manage its custom fields. */
export function ModulesListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ padding: '16px 24px', borderBottom: '1px solid #eef0f3' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Modules</h1>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
          Add custom fields to a module's forms. Fields you add apply only to this organization.
        </p>
      </header>

      <div
        style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}
      >
        {CUSTOM_FIELD_MODULES.map((m) => (
          <button
            key={m.entityType}
            onClick={() => navigate(`/organizations/${orgId}/settings/modules/${m.entityType}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              textAlign: 'left',
              padding: '16px 20px',
              background: '#fff',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: 'var(--primary-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
                flexShrink: 0,
              }}
            >
              <LayoutGrid size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{m.label}</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{m.description}</div>
            </div>
            <ChevronRight size={18} color="#94a3b8" />
          </button>
        ))}
      </div>
    </div>
  );
}
