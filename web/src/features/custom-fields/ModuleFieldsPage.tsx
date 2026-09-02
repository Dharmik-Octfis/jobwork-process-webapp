import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, Plus, Edit2, Archive, GripVertical } from 'lucide-react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import {
  useCustomFieldDefinitions,
  useReorderCustomFields,
  useArchiveCustomField,
} from './customFields.api';
import { FieldForm } from './FieldForm';
import {
  CUSTOM_FIELD_MODULES,
  dataTypeLabel,
  moduleLabel,
  type CustomFieldDefinition,
} from './customFields.schemas';

const th: React.CSSProperties = {
  padding: '10px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
};
const td: React.CSSProperties = { padding: '10px 16px', fontSize: 13, color: '#1e293b' };

export function ModuleFieldsPage() {
  const { orgId, entityType } = useParams<{ orgId: string; entityType: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const known = CUSTOM_FIELD_MODULES.some((m) => m.entityType === entityType);

  const {
    data: fields = [],
    isLoading,
    error,
  } = useCustomFieldDefinitions(orgId, entityType ?? '');
  const reorderMutation = useReorderCustomFields(orgId!, entityType ?? '');
  const archiveMutation = useArchiveCustomField(orgId!, entityType ?? '');

  const [view, setView] = useState<'list' | 'form'>('list');
  const [fieldToEdit, setFieldToEdit] = useState<CustomFieldDefinition | null>(null);
  const [fieldToArchive, setFieldToArchive] = useState<CustomFieldDefinition | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Optimistic order while a reorder mutation is in flight, so the row jumps to its
  // new spot immediately (drag can span any distance, not just one step).
  const [optimistic, setOptimistic] = useState<CustomFieldDefinition[] | null>(null);

  if (!known) {
    return <div style={{ padding: 32, color: '#dc2626' }}>Unknown module.</div>;
  }

  const forbidden = (error as { response?: { status?: number } })?.response?.status === 403;
  const rows = optimistic ?? fields;

  const handleDrop = (to: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from === null || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOptimistic(next);
    reorderMutation.mutate(
      next.map((f, i) => ({ id: f.id, displayOrder: i })),
      { onSettled: () => setOptimistic(null) },
    );
  };

  const openCreate = () => {
    setFieldToEdit(null);
    setView('form');
  };
  const openEdit = (f: CustomFieldDefinition) => {
    setFieldToEdit(f);
    setView('form');
  };

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
      <header style={{ padding: '16px 24px 0', borderBottom: '1px solid #eef0f3' }}>
        <button
          onClick={() => (location.state as any)?.returnUrl ? navigate((location.state as any).returnUrl) : navigate(`/organizations/${orgId}/settings/modules`)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            padding: 0,
            marginBottom: 8,
          }}
        >
          <ChevronLeft size={14} /> All modules
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>
          {moduleLabel(entityType!)}
        </h1>

        {/* Tabs — one tab today (Fields), matching Zoho's tabbed module settings. */}
        <div style={{ display: 'flex', gap: 24 }}>
          <div
            style={{
              padding: '10px 0',
              borderBottom: '2px solid var(--color-primary)',
              color: '#111',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Fields
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {view === 'form' ? (
          <FieldForm
            key={fieldToEdit?.id ?? 'new'}
            orgId={orgId!}
            entityType={entityType!}
            moduleLabel={moduleLabel(entityType!)}
            fieldToEdit={fieldToEdit}
            onDone={() => setView('list')}
            onCancel={() => setView('list')}
          />
        ) : (
          <div style={{ padding: 24 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>
                Fields you add here appear on the {moduleLabel(entityType!).toLowerCase()} form for
                this organization.
              </p>
              <button
                onClick={openCreate}
                style={{
                  background: '#186337',
                  color: 'white',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: 4,
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Plus size={16} /> New Field
              </button>
            </div>

            {forbidden ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                You need to be an organization owner or admin to manage custom fields.
              </div>
            ) : isLoading ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Loading…</div>
            ) : fields.length === 0 ? (
              <div
                style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  color: '#64748b',
                  border: '1px dashed #e2e8f0',
                  borderRadius: 8,
                }}
              >
                <p style={{ marginBottom: 16 }}>No custom fields for this module yet.</p>
                <button
                  onClick={openCreate}
                  style={{
                    background: '#fff',
                    color: 'var(--color-primary)',
                    border: '1px solid var(--color-border)',
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 14,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Plus size={16} /> Add your first field
                </button>
              </div>
            ) : (
              <table
                style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #eef0f3' }}
              >
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eef0f3' }}>
                    <th style={{ ...th, width: 44 }}></th>
                    <th style={th}>Label</th>
                    <th style={th}>Type</th>
                    <th style={th}>Required</th>
                    <th style={th}>Status</th>
                    <th style={{ ...th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f, i) => (
                    <tr
                      key={f.id}
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnter={() => setDragOverIndex(i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(i)}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setDragOverIndex(null);
                      }}
                      style={{
                        borderBottom: '1px solid #eef0f3',
                        borderTop:
                          dragOverIndex === i && dragIndex !== null && dragIndex !== i
                            ? '2px solid var(--color-primary)'
                            : '2px solid transparent',
                        background: dragIndex === i ? '#eff6ff' : '#fff',
                      }}
                    >
                      <td
                        style={{ ...td, cursor: 'grab', color: '#94a3b8', textAlign: 'center' }}
                        title="Drag to reorder"
                      >
                        <GripVertical size={16} />
                      </td>
                      <td style={{ ...td, fontWeight: 500 }}>{f.label}</td>
                      <td style={td}>{dataTypeLabel(f.dataType)}</td>
                      <td style={td}>{f.isRequired ? 'Yes' : '—'}</td>
                      <td style={td}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: f.status === 'hidden' ? '#fef3c7' : '#dcfce7',
                            color: f.status === 'hidden' ? '#92400e' : '#166534',
                          }}
                        >
                          {f.status === 'hidden' ? 'Hidden' : 'Active'}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => openEdit(f)}
                            title="Edit"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#64748b',
                            }}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => setFieldToArchive(f)}
                            title="Archive"
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#dc2626',
                            }}
                          >
                            <Archive size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!fieldToArchive}
        title="Archive field"
        message={
          <span>
            Archive <strong>{fieldToArchive?.label}</strong>? It will disappear from the form, but
            values already saved on existing records are kept in the database and its key stays
            reserved (so it can never be reused).
          </span>
        }
        confirmText={archiveMutation.isPending ? 'Archiving…' : 'Archive'}
        onCancel={() => setFieldToArchive(null)}
        onConfirm={async () => {
          if (fieldToArchive) {
            await archiveMutation.mutateAsync(fieldToArchive.id);
            setFieldToArchive(null);
          }
        }}
        isConfirming={archiveMutation.isPending}
      />
    </div>
  );
}
