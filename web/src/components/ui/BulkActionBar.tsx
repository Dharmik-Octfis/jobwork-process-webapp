import { X } from 'lucide-react';
import { useEffect } from 'react';

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onMarkActive?: () => void;
  onMarkInactive?: () => void;
  onDelete?: () => void;
  isProcessing?: boolean;
}

export function BulkActionBar({
  selectedCount,
  onClearSelection,
  onMarkActive,
  onMarkInactive,
  onDelete,
  isProcessing,
}: BulkActionBarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCount > 0) {
        onClearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCount, onClearSelection]);

  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '12px 24px',
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        gap: '10px',
        width: '100%',
        minHeight: '63px',
      }}
    >
      <button
        style={{
          background: '#f8fafc',
          color: '#94a3b8',
          border: '1px solid #e2e8f0',
          padding: '6px 14px',
          borderRadius: '6px',
          fontWeight: 500,
          fontSize: '13px',
          cursor: 'not-allowed',
        }}
        disabled
      >
        Bulk Update
      </button>

      {onMarkActive && (
        <button
          onClick={onMarkActive}
          disabled={isProcessing}
          style={{
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            padding: '6px 14px',
            borderRadius: '6px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#94a3b8';
              e.currentTarget.style.color = '#0f172a';
            }
          }}
          onMouseLeave={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.color = '#334155';
            }
          }}
        >
          Mark as Active
        </button>
      )}

      {onMarkInactive && (
        <button
          onClick={onMarkInactive}
          disabled={isProcessing}
          style={{
            background: '#ffffff',
            color: '#334155',
            border: '1px solid #cbd5e1',
            padding: '6px 14px',
            borderRadius: '6px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#94a3b8';
              e.currentTarget.style.color = '#0f172a';
            }
          }}
          onMouseLeave={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#cbd5e1';
              e.currentTarget.style.color = '#334155';
            }
          }}
        >
          Mark as Inactive
        </button>
      )}

      {onDelete && (
        <button
          onClick={onDelete}
          disabled={isProcessing}
          style={{
            background: '#ffffff',
            color: '#dc2626',
            border: '1px solid #fca5a5',
            padding: '6px 14px',
            borderRadius: '6px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#fef2f2';
              e.currentTarget.style.borderColor = '#ef4444';
            }
          }}
          onMouseLeave={(e) => {
            if (!isProcessing) {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#fca5a5';
            }
          }}
        >
          Delete
        </button>
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '13px',
          color: '#64748b',
          fontWeight: 500,
        }}
      >
        <span
          style={{
            background: '#f0f7fd',
            color: '#0284c7',
            border: '1px solid rgba(2, 132, 199, 0.25)',
            padding: '2px 9px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          {selectedCount}
        </span>
        Selected
        <button
          onClick={onClearSelection}
          disabled={isProcessing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'transparent',
            border: 'none',
            color: '#dc2626',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            padding: '4px 8px',
            fontSize: '13px',
            fontWeight: 500,
            opacity: isProcessing ? 0.5 : 1,
            borderRadius: '4px',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!isProcessing) e.currentTarget.style.background = '#fef2f2';
          }}
          onMouseLeave={(e) => {
            if (!isProcessing) e.currentTarget.style.background = 'transparent';
          }}
        >
          Esc <X size={14} />
        </button>
      </div>
    </div>
  );
}
