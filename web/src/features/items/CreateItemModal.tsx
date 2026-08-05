import { X } from 'lucide-react';
import { CreateItemPage } from './CreateItemPage';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (itemId: string) => void;
}

export function CreateItemModal({ isOpen, onClose, onSuccess }: CreateItemModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '0 20px 20px 20px',
      }}
    >
      <div
        style={{
          width: '1000px',
          maxWidth: '100%',
          maxHeight: '95vh',
          backgroundColor: '#f8fafc',
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
          animation: 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <style>
          {`
            @keyframes slideDown {
              from { opacity: 0; transform: translateY(-20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}
        </style>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#ffffff',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1e293b' }}>
            New Item
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <CreateItemPage
            isModal={true}
            onSuccess={(id) => {
              onSuccess?.(id);
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
