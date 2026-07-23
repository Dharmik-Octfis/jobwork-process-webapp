import { X } from 'lucide-react';
import { useState } from 'react';

interface CustomerNumberConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (prefix: string, nextNumber: string) => void;
  initialPrefix?: string;
  initialNextNumber?: string;
}

export function CustomerNumberConfigModal({
  isOpen,
  onClose,
  onSave,
  initialPrefix = 'VEN-',
  initialNextNumber = '00727',
}: CustomerNumberConfigModalProps) {
  const [prefix, setPrefix] = useState(initialPrefix);
  const [nextNumber, setNextNumber] = useState(initialNextNumber);

  // Sync state with props when they change
  const [prevProps, setPrevProps] = useState({ initialPrefix, initialNextNumber });
  if (initialPrefix !== prevProps.initialPrefix || initialNextNumber !== prevProps.initialNextNumber) {
    setPrevProps({ initialPrefix, initialNextNumber });
    if (initialPrefix) setPrefix(initialPrefix);
    if (initialNextNumber) setNextNumber(initialNextNumber);
  }

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: 'white', borderRadius: '8px', width: '600px', maxWidth: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', marginTop: '80px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #eef0f3' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 500, color: '#2b2b2b' }}>Configure Customer Numbers Preferences</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e54d4d', display: 'flex', alignItems: 'center', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          <p style={{ margin: '0 0 24px 0', color: '#444', fontSize: '14px', lineHeight: '1.5' }}>
            Customer numbers will be auto-generated based on the preferences below. For each new customer that is created, the number after the prefix will be incremented by 1.
          </p>

          <div style={{ display: 'flex', gap: '24px', marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#444', marginBottom: '8px' }}>Prefix</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#444', marginBottom: '8px' }}>Next Number</label>
              <input
                type="text"
                value={nextNumber}
                onChange={(e) => setNextNumber(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '4px', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ backgroundColor: '#fff9e6', padding: '16px', borderRadius: '6px', color: '#5c4813', fontSize: '13px', lineHeight: '1.5' }}>
            Note: If you want to change only this customer's number without affecting the current series, you can edit it directly from the Customer Number field after closing this popup.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #eef0f3', display: 'flex', gap: '12px' }}>
          <button
            type="button"
            onClick={() => onSave(prefix, nextNumber)}
            style={{ padding: '8px 20px', backgroundColor: '#0062ff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 20px', backgroundColor: '#f9f9f9', color: '#333', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
