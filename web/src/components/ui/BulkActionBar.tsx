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
        background: '#fff',
        borderBottom: '1px solid #eef0f3',
        gap: '12px',
        width: '100%',
        minHeight: '63px', // Match the height of the normal header
      }}
    >
      <button
        style={{
          background: '#f1f5f9',
          color: '#1e293b',
          border: '1px solid #e2e8f0',
          padding: '6px 12px',
          borderRadius: '4px',
          fontWeight: 500,
          fontSize: '13px',
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
            background: '#fff',
            color: '#1e293b',
            border: '1px solid #e2e8f0',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
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
            background: '#fff',
            color: '#1e293b',
            border: '1px solid #e2e8f0',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
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
            background: '#fff',
            color: '#ef4444',
            border: '1px solid #e2e8f0',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            opacity: isProcessing ? 0.5 : 1,
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
            background: '#e0e7ff',
            color: '#3730a3',
            padding: '2px 8px',
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
            color: '#ef4444',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            padding: '4px 8px',
            fontSize: '13px',
            fontWeight: 500,
            opacity: isProcessing ? 0.5 : 1,
          }}
        >
          Esc <X size={14} />
        </button>
      </div>
    </div>
  );
}
