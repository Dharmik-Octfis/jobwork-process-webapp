import { X, History, Calendar, Clock, Hash } from 'lucide-react';
import type { Item } from '../items.schemas';

interface HsnSacHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
}

export function HsnSacHistoryModal({ isOpen, onClose, items }: HsnSacHistoryModalProps) {
  if (!isOpen) return null;

  // Items that have HSN code specified, sorted by most recently updated
  const itemsWithHsn = items
    .filter((i) => i.hsnCode && i.hsnCode.trim())
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime(),
    );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          width: '90%',
          maxWidth: 680,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 24px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: '#f0f9ff',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <History size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                HSN / SAC Update History
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Log of HSN and SAC code assignments across your catalog
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {itemsWithHsn.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8' }}>
              No items with HSN/SAC codes recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {itemsWithHsn.map((item) => {
                const dateVal = item.updatedAt || item.createdAt;
                const dateObj = dateVal ? new Date(dateVal) : new Date();
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: 8,
                      background: '#f8fafc',
                      border: '1px solid #eef2f6',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          padding: '6px 10px',
                          borderRadius: 6,
                          background: '#e0f2fe',
                          color: '#0284c7',
                          fontWeight: 700,
                          fontSize: 13,
                          fontFamily: 'monospace',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Hash size={13} /> {item.hsnCode}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                          {item.sku} • {item.itemType}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Calendar size={12} />
                        {dateObj.toLocaleDateString()}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          justifyContent: 'flex-end',
                          marginTop: 2,
                        }}
                      >
                        <Clock size={12} />
                        {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '14px 24px',
            borderTop: '1px solid #f1f5f9',
            background: '#fafafa',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              border: 'none',
              background: '#0284c7',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
