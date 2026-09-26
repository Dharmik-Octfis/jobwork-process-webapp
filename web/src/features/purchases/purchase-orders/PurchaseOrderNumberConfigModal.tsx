import { X, Info, Plus } from 'lucide-react';
import { useState } from 'react';

interface PurchaseOrderNumberConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (prefix: string, nextNumber: string) => void;
  initialPrefix?: string;
  initialNextNumber?: string;
}

export function PurchaseOrderNumberConfigModal({
  isOpen,
  onClose,
  onSave,
  initialPrefix = 'PO-',
  initialNextNumber = '00001',
}: PurchaseOrderNumberConfigModalProps) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [prefix, setPrefix] = useState(initialPrefix);
  const [nextNumber, setNextNumber] = useState(initialNextNumber);
  const [restartFiscalYear, setRestartFiscalYear] = useState(false);

  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setPrefix(initialPrefix || 'PO-');
      setNextNumber(initialNextNumber || '00001');
    }
  }

  if (!isOpen) return null;

  const handleSave = () => {
    onSave(prefix, nextNumber);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '60px',
        zIndex: 1000,
        backdropFilter: 'blur(1px)',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          width: '580px',
          maxWidth: '92%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 24px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1e293b' }}>
            Configure Purchase Order# Preferences
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '4px',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', color: '#334155' }}>
          <p
            style={{
              margin: '0 0 20px 0',
              color: '#475569',
              fontSize: '13.5px',
              lineHeight: '1.5',
            }}
          >
            Your purchase order numbers are set on auto-generate mode to save your time. Are you
            sure about changing this setting?
          </p>

          {/* Option 1: Auto generate */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '13.5px',
                fontWeight: 500,
                color: '#1e293b',
              }}
            >
              <input
                type="radio"
                name="poNumberMode"
                value="auto"
                checked={mode === 'auto'}
                onChange={() => setMode('auto')}
                style={{ accentColor: '#0284c7', width: 16, height: 16, cursor: 'pointer' }}
              />
              <span>Continue auto-generating purchase order numbers</span>
              <Info size={14} color="#94a3b8" />
            </label>

            {mode === 'auto' && (
              <div style={{ marginTop: '16px', marginLeft: '26px' }}>
                <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: '#64748b',
                        fontWeight: 500,
                        marginBottom: '6px',
                      }}
                    >
                      Prefix
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '7px 32px 7px 10px',
                          fontSize: '13px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '5px',
                          outline: 'none',
                          boxSizing: 'border-box',
                          color: '#1e293b',
                        }}
                      />
                      <div
                        title="Add dynamic placeholder"
                        style={{
                          position: 'absolute',
                          right: '8px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          backgroundColor: '#0284c7',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Plus size={12} strokeWidth={3} />
                      </div>
                    </div>
                  </div>

                  <div style={{ flex: 1.2 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '12px',
                        color: '#64748b',
                        fontWeight: 500,
                        marginBottom: '6px',
                      }}
                    >
                      Next Number
                    </label>
                    <input
                      type="text"
                      value={nextNumber}
                      onChange={(e) => setNextNumber(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        fontSize: '13px',
                        border: '1px solid #cbd5e1',
                        borderRadius: '5px',
                        outline: 'none',
                        boxSizing: 'border-box',
                        color: '#1e293b',
                      }}
                    />
                  </div>
                </div>

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={restartFiscalYear}
                    onChange={(e) => setRestartFiscalYear(e.target.checked)}
                    style={{ accentColor: '#0284c7', cursor: 'pointer' }}
                  />
                  <span>
                    Restart numbering for purchase orders at the start of each fiscal year.
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* Option 2: Manual */}
          <div style={{ marginTop: '16px' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '13.5px',
                fontWeight: 500,
                color: '#1e293b',
              }}
            >
              <input
                type="radio"
                name="poNumberMode"
                value="manual"
                checked={mode === 'manual'}
                onChange={() => setMode('manual')}
                style={{ accentColor: '#0284c7', width: 16, height: 16, cursor: 'pointer' }}
              />
              <span>Enter purchase order numbers manually</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            backgroundColor: '#ffffff',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '7px 20px',
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#059669')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#10b981')}
          >
            Save
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 18px',
              backgroundColor: '#ffffff',
              color: '#334155',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f8fafc';
              e.currentTarget.style.borderColor = '#94a3b8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
