import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';

interface Props {
  onClose: () => void;
  onSave: (prefix: string, nextNumber: string) => void;
  isSaving?: boolean;
  initialPrefix?: string;
  initialNextNumber?: string;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  minHeight: 32,
  boxSizing: 'border-box',
};

/**
 * The job order numbering master — the Vendor Number dialog, for job orders.
 *
 * It writes the same `number_sequences` row the server allocates from at save
 * time, so the number shown on the form is the number the next order gets. It is
 * built on `Modal` rather than copying the vendor dialog's markup, which is a
 * hand-rolled overlay with no focus trap (CLAUDE.md's Tab rule).
 *
 * 🔴 The caller MOUNTS it to open it — there is no `isOpen` prop. That is what
 * seeds the two fields from the current preference every time, with no effect
 * syncing props into state and no chance of the dialog opening on a stale series
 * and saving it back.
 */
export function JobOrderNumberConfigModal({
  onClose,
  onSave,
  isSaving,
  initialPrefix = 'JO-',
  initialNextNumber = '00001',
}: Props) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [nextNumber, setNextNumber] = useState(initialNextNumber);

  const parsed = Number(nextNumber);
  const isValid = /^\d+$/.test(nextNumber.trim()) && parsed >= 1;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Configure Job Order Numbers Preferences"
      width={600}
      footer={
        <>
          <button
            type="button"
            disabled={!isValid || isSaving}
            onClick={() => onSave(prefix, nextNumber)}
            style={{
              padding: '6px 20px',
              background: isValid && !isSaving ? '#0062ff' : '#94a3b8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: isValid && !isSaving ? 'pointer' : 'not-allowed',
              fontWeight: 500,
              fontSize: 13,
            }}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
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
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="jo-number-prefix">
            Prefix
          </label>
          <input
            id="jo-number-prefix"
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={labelStyle} htmlFor="jo-number-next">
            Next Number
          </label>
          <input
            id="jo-number-next"
            type="text"
            inputMode="numeric"
            value={nextNumber}
            onChange={(e) => setNextNumber(e.target.value)}
            aria-invalid={!isValid}
            style={{ ...inputStyle, borderColor: isValid ? '#d1d5db' : '#e54d4d' }}
          />
          {!isValid && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: '#e54d4d' }}>
              Digits only, and at least 1.
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
