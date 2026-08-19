import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';

interface BillNumberConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (prefix: string, nextNumber: string) => void;
  initialPrefix?: string;
  initialNextNumber?: string;
}

export function BillNumberConfigModal({
  isOpen,
  onClose,
  onSave,
  initialPrefix = 'BILL-',
  initialNextNumber = '00001',
}: BillNumberConfigModalProps) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [nextNumber, setNextNumber] = useState(initialNextNumber);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setPrefix(initialPrefix);
      setNextNumber(initialNextNumber);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configure Bill Numbers Preferences"
      width={600}
      footer={
        <>
          <button
            type="button"
            onClick={() => onSave(prefix, nextNumber)}
            style={{
              padding: '8px 20px',
              backgroundColor: '#0062ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              backgroundColor: '#f9f9f9',
              color: '#333',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 24px 0', color: '#444', fontSize: '14px', lineHeight: '1.5' }}>
        Bill numbers will be auto-generated based on the preferences below. For each new Bill that
        is created, the number after the prefix will be incremented by 1.
      </p>

      <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '13px', color: '#444', marginBottom: '8px' }}>
            Prefix
          </label>
          <input
            type="text"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ display: 'block', fontSize: '13px', color: '#444', marginBottom: '8px' }}>
            Next Number
          </label>
          <input
            type="text"
            value={nextNumber}
            onChange={(e) => setNextNumber(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <div
        style={{
          backgroundColor: '#fff9e6',
          padding: '16px',
          borderRadius: '6px',
          color: '#5c4813',
          fontSize: '13px',
          lineHeight: '1.5',
        }}
      >
        Note: If you want to change only this Bill's number without affecting the current series,
        you can edit it directly from the Bill Number field after closing this popup.
      </div>
    </Modal>
  );
}
