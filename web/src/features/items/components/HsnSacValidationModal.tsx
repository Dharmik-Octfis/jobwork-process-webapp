import { useState } from 'react';
import { X, CheckCircle2, AlertCircle, HelpCircle, Search, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Item } from '../items.schemas';

interface HsnSacValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  orgId: string;
}

export function HsnSacValidationModal({
  isOpen,
  onClose,
  items,
  orgId,
}: HsnSacValidationModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'valid' | 'invalid' | 'missing'>('all');
  const navigate = useNavigate();

  if (!isOpen) return null;

  // HSN validation: Goods typically have 4, 6, or 8 digits. Services typically have SAC 6 digits (usually starting with 99).
  const validateHsn = (code: string | null | undefined, itemType: string) => {
    if (!code || !code.trim()) {
      return { status: 'missing', message: 'HSN/SAC not specified' };
    }
    const clean = code.trim().replace(/[^0-9]/g, '');
    if (clean.length === 0) {
      return { status: 'invalid', message: 'Code contains no numbers' };
    }
    if (itemType === 'service') {
      if (clean.length === 6 && clean.startsWith('99')) {
        return { status: 'valid', message: 'Valid SAC code (6 digits)' };
      }
      if (clean.length === 6) {
        return { status: 'valid', message: 'Standard 6-digit service code' };
      }
      return { status: 'invalid', message: 'Services should have 6-digit SAC' };
    }
    // Goods
    if ([4, 6, 8].includes(clean.length)) {
      return { status: 'valid', message: `Valid HSN code (${clean.length} digits)` };
    }
    return {
      status: 'invalid',
      message: `Invalid digit length (${clean.length}). Expected 4, 6, or 8 digits.`,
    };
  };

  const analyzedItems = items.map((item) => {
    const val = validateHsn(item.hsnCode, item.itemType);
    return {
      ...item,
      hsnStatus: val.status as 'valid' | 'invalid' | 'missing',
      hsnMessage: val.message,
    };
  });

  const validCount = analyzedItems.filter((i) => i.hsnStatus === 'valid').length;
  const invalidCount = analyzedItems.filter((i) => i.hsnStatus === 'invalid').length;
  const missingCount = analyzedItems.filter((i) => i.hsnStatus === 'missing').length;

  const filteredItems = analyzedItems.filter((item) => {
    if (filterStatus !== 'all' && item.hsnStatus !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        (item.sku && item.sku.toLowerCase().includes(q)) ||
        (item.hsnCode && item.hsnCode.toLowerCase().includes(q))
      );
    }
    return true;
  });

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
          maxWidth: 780,
          maxHeight: '90vh',
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
              <CheckCircle2 size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                HSN / SAC Code Validation
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>
                Verify GST HSN code compliance for billing and tax accuracy
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
          {/* Summary KPI Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div
              onClick={() => setFilterStatus(filterStatus === 'valid' ? 'all' : 'valid')}
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: filterStatus === 'valid' ? '#f0fdf4' : '#fafafa',
                border: filterStatus === 'valid' ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#16a34a',
                  textTransform: 'uppercase',
                }}
              >
                Valid HSN / SAC
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                {validCount}
              </div>
            </div>

            <div
              onClick={() => setFilterStatus(filterStatus === 'invalid' ? 'all' : 'invalid')}
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: filterStatus === 'invalid' ? '#fef2f2' : '#fafafa',
                border: filterStatus === 'invalid' ? '1.5px solid #dc2626' : '1px solid #e2e8f0',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#dc2626',
                  textTransform: 'uppercase',
                }}
              >
                Invalid Format
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                {invalidCount}
              </div>
            </div>

            <div
              onClick={() => setFilterStatus(filterStatus === 'missing' ? 'all' : 'missing')}
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                background: filterStatus === 'missing' ? '#fffbeb' : '#fafafa',
                border: filterStatus === 'missing' ? '1.5px solid #d97706' : '1px solid #e2e8f0',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#d97706',
                  textTransform: 'uppercase',
                }}
              >
                Missing Code
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>
                {missingCount}
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <Search
              size={15}
              color="#94a3b8"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              placeholder="Search by name, SKU, or HSN code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {/* List Table */}
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                    Item Name
                  </th>
                  <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Type</th>
                  <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>
                    HSN/SAC Code
                  </th>
                  <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Status</th>
                  <th
                    style={{
                      padding: '8px 12px',
                      color: '#64748b',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}
                    >
                      No items matching current filter
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontWeight: 500, color: '#0f172a' }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                          {item.sku}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          textTransform: 'capitalize',
                          color: '#475569',
                        }}
                      >
                        {item.itemType}
                      </td>
                      <td
                        style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#0f172a' }}
                      >
                        {item.hsnCode || '-'}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        {item.hsnStatus === 'valid' && (
                          <span
                            style={{
                              color: '#16a34a',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <CheckCircle2 size={13} /> {item.hsnMessage}
                          </span>
                        )}
                        {item.hsnStatus === 'invalid' && (
                          <span
                            style={{
                              color: '#dc2626',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <AlertCircle size={13} /> {item.hsnMessage}
                          </span>
                        )}
                        {item.hsnStatus === 'missing' && (
                          <span
                            style={{
                              color: '#d97706',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <HelpCircle size={13} /> Not specified
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(`/organizations/${orgId}/items/${item.id}/edit`);
                            onClose();
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: 'none',
                            background: 'transparent',
                            color: '#0284c7',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          Edit <ExternalLink size={12} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
