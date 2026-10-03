import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import { toApiErrorMessage } from '../../../api/client';
import { createReason, deleteReason, fetchReasons, setReasonActive } from './adjustments.api';
import { reasonsQueryKey, type AdjustmentReason } from './adjustments.schemas';
import { formPrimaryButton, formSecondaryButton } from './adjustmentButtons';
import styles from './ManageReasonsModal.module.css';

interface ManageReasonsModalProps {
  orgId: string;
  isOpen: boolean;
  onClose: () => void;
  /** "Save and Select" — the new reason becomes the form's choice. */
  onSelect: (reasonId: string) => void;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 44,
  padding: '0 8px',
  borderBottom: '1px solid #eef0f3',
  fontSize: 13,
};

const linkButton: React.CSSProperties = {
  minHeight: 44,
  padding: '0 8px',
  background: 'none',
  border: 'none',
  color: '#475569',
  fontSize: 13,
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function ManageReasonsModal({ orgId, isOpen, onClose, onSelect }: ManageReasonsModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: reasonsQueryKey(orgId),
    queryFn: () => fetchReasons(orgId),
    enabled: isOpen,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: reasonsQueryKey(orgId) });

  const create = useMutation({
    mutationFn: (value: string) => createReason(orgId, value),
    onSuccess: async (reason) => {
      await refresh();
      setName('');
      onSelect(reason.id);
    },
    onError: (error) => {
      setNameInvalid(true);
      toast.error(toApiErrorMessage(error));
    },
  });

  const toggle = useMutation({
    mutationFn: (reason: AdjustmentReason) => setReasonActive(orgId, reason.id, !reason.isActive),
    onSuccess: () => {
      void refresh();
    },
    onError: (error) => toast.error(toApiErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (reason: AdjustmentReason) => deleteReason(orgId, reason.id),
    onSuccess: () => {
      setConfirmingDelete(null);
      void refresh();
    },
    onError: (error) => {
      setConfirmingDelete(null);
      void refresh();
      toast.error(toApiErrorMessage(error));
    },
  });

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameInvalid(true);
      toast.error('Enter a reason.');
      return;
    }
    create.mutate(trimmed);
  };

  const close = () => {
    setName('');
    setNameInvalid(false);
    setConfirmingDelete(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title="Manage Reasons" onClose={close} width={640} position="top">
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 6,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <label
          htmlFor="new-adjustment-reason"
          style={{ display: 'block', color: '#dc2626', fontSize: 13, marginBottom: 6 }}
        >
          Reason*
        </label>
        <input
          id="new-adjustment-reason"
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            setNameInvalid(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
          style={{
            width: '100%',
            maxWidth: 420,
            boxSizing: 'border-box',
            padding: '8px 10px',
            border: `1px solid ${nameInvalid ? '#dc2626' : '#d1d5db'}`,
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={save}
            disabled={create.isPending}
            style={formPrimaryButton(create.isPending)}
          >
            Save and Select
          </button>
          <button
            type="button"
            onClick={close}
            disabled={create.isPending}
            style={formSecondaryButton(create.isPending)}
          >
            Cancel
          </button>
        </div>
      </div>

      <div
        style={{
          ...rowStyle,
          minHeight: 36,
          background: '#f8fafc',
          color: '#64748b',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.3,
        }}
      >
        REASON
      </div>
      {isLoading && <div style={{ ...rowStyle, color: '#94a3b8' }}>Loading…</div>}
      {!isLoading && reasons.length === 0 && (
        <div style={{ ...rowStyle, color: '#94a3b8' }}>No reasons yet.</div>
      )}
      {reasons.map((reason) => (
        <div key={reason.id} className={styles.row}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: reason.isActive ? '#111827' : '#94a3b8',
            }}
          >
            {reason.name}
            {!reason.isActive && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: '#f1f5f9',
                  color: '#64748b',
                  fontSize: 11,
                }}
              >
                Inactive
              </span>
            )}
          </span>

          <div
            className={`${styles.actions} ${confirmingDelete === reason.id ? styles.pinned : ''}`}
          >
            {confirmingDelete === reason.id ? (
              <>
                <span style={{ color: '#475569' }}>Delete?</span>
                <button
                  type="button"
                  onClick={() => remove.mutate(reason)}
                  disabled={remove.isPending}
                  style={{ ...linkButton, color: '#dc2626', fontWeight: 500 }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(null)}
                  disabled={remove.isPending}
                  style={linkButton}
                >
                  Keep
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggle.mutate(reason)}
                  disabled={toggle.isPending}
                  style={linkButton}
                >
                  {reason.isActive ? 'Mark as Inactive' : 'Mark as Active'}
                </button>
                {/* A reason an adjustment carries stays; deactivate it instead. */}
                {!reason.inUse && (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(reason.id)}
                    aria-label={`Delete ${reason.name}`}
                    title="Delete"
                    style={{
                      ...linkButton,
                      color: '#dc2626',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
    </Modal>
  );
}
