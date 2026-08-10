import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { Select } from '../../../components/ui/Select';
import { RESPONSIBILITY_OPTIONS } from '../jobwork.schemas';
import {
  createRejectionReason,
  deleteRejectionReason,
  fetchRejectionReasons,
  updateRejectionReason,
  type CreateRejectionReasonData,
  type RejectionReason,
} from './rejectionReasons.api';

const th: React.CSSProperties = {
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
};

const td: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: '#333' };

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  minHeight: 32,
};

const empty: CreateRejectionReasonData = {
  name: '',
  code: null,
  description: null,
  defaultResponsibility: null,
};

/**
 * The rejection-reason master.
 *
 * A short list on one screen, edited in a dialog rather than on its own pages —
 * an org has a dozen of these and they are typed once. The reason it exists at
 * all is on the screen: free text cannot be grouped, and grouping is the entire
 * point of recording why something was rejected.
 */
export function RejectionReasonsList() {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<RejectionReason | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<CreateRejectionReasonData>(empty);
  const [toDelete, setToDelete] = useState<RejectionReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['rejection-reasons', orgId, 'all'],
    queryFn: () => fetchRejectionReasons(orgId!, { filter: 'all', perPage: 200 }),
    enabled: Boolean(orgId),
  });
  const reasons = data?.results ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['rejection-reasons', orgId] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateRejectionReason({ orgId: orgId!, id: editing.id, data: form })
        : createRejectionReason(orgId!, form),
    onSuccess: () => {
      invalidate();
      setIsFormOpen(false);
      setEditing(null);
      setForm(empty);
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not save that reason');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRejectionReason(orgId!, id),
    onSuccess: () => {
      invalidate();
      setToDelete(null);
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm(empty);
    setError(null);
    setIsFormOpen(true);
  };

  const openEdit = (reason: RejectionReason) => {
    setEditing(reason);
    setForm({
      name: reason.name,
      code: reason.code,
      description: reason.description,
      defaultResponsibility: reason.defaultResponsibility,
    });
    setError(null);
    setIsFormOpen(true);
  };

  return (
    <div style={{ background: '#fff', minHeight: '100%' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          gap: 16,
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#000', margin: 0 }}>
          Rejection Reasons
        </h1>
        <button
          type="button"
          onClick={openCreate}
          style={{
            background: '#186337',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: 4,
            fontWeight: 500,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={16} /> New
        </button>
      </header>

      <div style={{ padding: '0 0 24px 0' }}>
        {isLoading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Loading…</div>
        ) : reasons.length === 0 ? (
          <div
            style={{ padding: '48px 32px', textAlign: 'center', color: '#64748b', fontSize: 13 }}
          >
            No reasons yet. Add the handful your shop floor actually uses — shade off, short length,
            hole, stain.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                <th style={th} scope="col">
                  Reason
                </th>
                <th style={th} scope="col">
                  Code
                </th>
                <th style={th} scope="col">
                  Usually
                </th>
                <th style={{ ...th, width: 90 }} scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {reasons.map((reason) => (
                <tr key={reason.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                  <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                    {reason.name}
                    {reason.description && (
                      <span style={{ display: 'block', fontSize: 11, color: '#94a3b8' }}>
                        {reason.description}
                      </span>
                    )}
                  </td>
                  <td style={td}>{reason.code ?? '-'}</td>
                  <td style={td}>
                    {reason.defaultResponsibility === 'ours'
                      ? 'Our fault'
                      : reason.defaultResponsibility === 'theirs'
                        ? 'Their fault'
                        : '—'}
                  </td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => openEdit(reason)}
                        aria-label={`Edit ${reason.name}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 28,
                          height: 28,
                          border: '1px solid #e2e8f0',
                          borderRadius: 4,
                          background: '#fff',
                          cursor: 'pointer',
                          color: '#64748b',
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setToDelete(reason)}
                        aria-label={`Delete ${reason.name}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 28,
                          height: 28,
                          border: '1px solid #e2e8f0',
                          borderRadius: 4,
                          background: '#fff',
                          cursor: 'pointer',
                          color: '#94a3b8',
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New rejection reason'}
        width={520}
        footer={
          <>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={!form.name.trim() || saveMutation.isPending}
              style={{
                padding: '6px 20px',
                background: form.name.trim() ? '#0062ff' : '#f1f5f9',
                color: form.name.trim() ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 4,
                cursor: form.name.trim() ? 'pointer' : 'not-allowed',
                fontWeight: 500,
                fontSize: 13,
              }}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              style={{
                padding: '6px 20px',
                background: '#fff',
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
          </>
        }
      >
        {error && (
          <p
            style={{
              fontSize: 13,
              color: '#b91c1c',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              padding: '8px 12px',
              margin: '0 0 16px 0',
            }}
            role="alert"
          >
            {error}
          </p>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ ...labelStyle, color: '#ef4444' }} htmlFor="reason-name">
            Reason*
          </label>
          <input
            id="reason-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            style={inputStyle}
            placeholder="Shade off"
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="reason-code">
            Code
          </label>
          <input
            id="reason-code"
            type="text"
            value={form.code ?? ''}
            onChange={(e) => setForm({ ...form, code: e.target.value || null })}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle} htmlFor="reason-description">
            Description
          </label>
          <textarea
            id="reason-description"
            value={form.description ?? ''}
            onChange={(e) => setForm({ ...form, description: e.target.value || null })}
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Usually whose fault</label>
          <Select
            value={form.defaultResponsibility ?? ''}
            onChange={(value) => setForm({ ...form, defaultResponsibility: value || null })}
            options={[{ value: '', label: 'Decide per receipt' }, ...RESPONSIBILITY_OPTIONS]}
            ariaLabel="Default responsibility"
            fullWidth
          />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(toDelete)}
        title="Delete reason"
        message={
          toDelete
            ? `Delete "${toDelete.name}"? Receipts that already cite it keep showing it, so past wastage analysis is unaffected.`
            : ''
        }
        confirmText={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        onConfirm={() => {
          if (toDelete) deleteMutation.mutate(toDelete.id);
        }}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
