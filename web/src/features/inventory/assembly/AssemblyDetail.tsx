import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  FileText,
  ChevronDown,
  AlertCircle,
  Info,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { assembliesApi } from './assemblies.api';
import { formatDate } from '../../../lib/formatDate';

interface AssemblyDetailProps {
  orgId: string;
  assemblyId: string;
  onClose: () => void;
}

export function AssemblyDetail({ orgId, assemblyId, onClose }: AssemblyDetailProps) {
  const [activeTab, setActiveTab] = useState('Overview');
  const { data: assembly, isLoading } = useQuery({
    queryKey: ['assembly', orgId, assemblyId],
    queryFn: () => assembliesApi.getById(orgId, assemblyId),
    enabled: Boolean(orgId && assemblyId),
  });

  if (isLoading) {
    return (
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Loading assembly details...
      </div>
    );
  }

  if (!assembly) {
    return (
      <div style={{ padding: 24, display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Assembly not found.
      </div>
    );
  }

  const goodsItems = assembly.lines.filter((line) => line.item.type !== 'Service');
  const serviceItems = assembly.lines.filter((line) => line.item.type === 'Service');

  const formatMoney = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(value);
  const getLineAmount = (line: (typeof assembly.lines)[number]) =>
    line.value > 0 ? line.value : Number((line.qty * line.unitValue).toFixed(4));
  const getSectionTotal = (lines: typeof assembly.lines) =>
    lines.reduce((sum, line) => sum + getLineAmount(line), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: 0 }}>
          {assembly.assemblyNumber}
        </h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              border: '1px solid #eef0f3',
              borderRadius: 6,
              background: '#fff',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 24px',
          borderBottom: '1px solid #eef0f3',
          background: '#f8fafc',
        }}
      >
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
            border: 'none',
            background: 'transparent',
            color: '#334155',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <FileText size={14} />
          PDF/Print
          <ChevronDown size={14} />
        </button>
        <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />
        <button
          type="button"
          onClick={() => setActiveTab('Overview')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 0',
            border: 'none',
            borderBottom: activeTab === 'Overview' ? '2px solid #0062ff' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'Overview' ? '#0062ff' : '#64748b',
            fontSize: 13,
            fontWeight: activeTab === 'Overview' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          Overview
        </button>
        <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />
        <button
          type="button"
          onClick={() => setActiveTab('Delete')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 0',
            border: 'none',
            borderBottom: activeTab === 'Delete' ? '2px solid #0062ff' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'Delete' ? '#0062ff' : '#64748b',
            fontSize: 13,
            fontWeight: activeTab === 'Delete' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} />
          Delete
        </button>
        <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />
        <button
          type="button"
          onClick={() => setActiveTab('Comment')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 0',
            border: 'none',
            borderBottom: activeTab === 'Comment' ? '2px solid #0062ff' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'Comment' ? '#0062ff' : '#64748b',
            fontSize: 13,
            fontWeight: activeTab === 'Comment' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          Comment
        </button>
        <div style={{ width: 1, height: 16, background: '#cbd5e1' }} />
        <button
          type="button"
          onClick={() => setActiveTab('History')}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 0',
            border: 'none',
            borderBottom: activeTab === 'History' ? '2px solid #0062ff' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'History' ? '#0062ff' : '#64748b',
            fontSize: 13,
            fontWeight: activeTab === 'History' ? 600 : 500,
            cursor: 'pointer',
          }}
        >
          History
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div
          style={{
            background: '#fff9f0',
            border: '1px solid #ffedd5',
            borderRadius: 8,
            padding: 16,
            marginBottom: 32,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ color: '#ea580c' }}>
              <AlertCircle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>
                Advanced Tracking Details Missing
              </div>
              <div style={{ color: '#334155', fontSize: 13, marginTop: 4 }}>
                One or more items in this transaction don't have their serial number or batch tracking details.
              </div>
            </div>
          </div>
          <button
            type="button"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#0062ff',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Update Details
          </button>
        </div>

        <h3 style={{ fontSize: 18, fontWeight: 500, color: '#1e293b', margin: '0 0 16px' }}>
          ASSEMBLY DETAILS
        </h3>
        <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 32px' }}>
          Assembly# {assembly.assemblyNumber}
        </p>

        <div style={{ display: 'flex', gap: 64, marginBottom: 48 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ width: 160, color: '#64748b', fontSize: 13 }}>Assembled Date</div>
              <div style={{ color: '#1e293b', fontSize: 14 }}>{formatDate(assembly.assemblyDate)}</div>
            </div>
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ width: 160, color: '#64748b', fontSize: 13 }}>Location Name</div>
              <div style={{ color: '#1e293b', fontSize: 14 }}>{assembly.location?.name || '-'}</div>
            </div>
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ width: 160, color: '#64748b', fontSize: 13 }}>Composite Item</div>
              <div style={{ color: '#0062ff', fontSize: 14 }}>{assembly.compositeItem?.name || '-'}</div>
            </div>
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ width: 160, color: '#64748b', fontSize: 13 }}>Composite Item SKU</div>
              <div style={{ color: '#1e293b', fontSize: 14 }}>{assembly.compositeItem?.sku || '-'}</div>
            </div>
            <div style={{ display: 'flex', marginBottom: 16 }}>
              <div style={{ width: 160, color: '#64748b', fontSize: 13 }}>Status</div>
              <div>
                <span
                  style={{
                    padding: '2px 8px',
                    background: '#22c55e',
                    color: '#fff',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {assembly.status}
                </span>
              </div>
            </div>
          </div>
          <div style={{ width: 320 }}>
            <div style={{ background: '#f8fafc', padding: 24, borderRadius: 8, marginBottom: 24 }}>
              <div
                style={{
                  color: '#1e293b',
                  fontSize: 16,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                Total
                <Info size={14} color="#64748b" />
              </div>
              <div style={{ color: '#0f172a', fontSize: 28, fontWeight: 600 }}>
                {formatMoney(assembly.totalValue)}
              </div>
            </div>
            <div>
              <div style={{ color: '#1e293b', fontSize: 14, marginBottom: 4 }}>Quantity Assembled</div>
              <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 500 }}>{assembly.qty}</div>
            </div>
          </div>
        </div>

        {goodsItems.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <h4 style={{ fontSize: 16, fontWeight: 500, color: '#1e293b', margin: '0 0 16px' }}>Items</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '2px solid #eef0f3',
                    color: '#64748b',
                    fontSize: 12,
                    textTransform: 'uppercase',
                  }}
                >
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Item Details</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Quantity Consumed</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Total Qty Consumed</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Cost Per Unit</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {goodsItems.map((line) => (
                  <tr key={line.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                    <td style={{ padding: '16px', display: 'flex', gap: 12 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          background: '#f8fafc',
                          border: '1px solid #eef0f3',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#cbd5e1',
                        }}
                      >
                        <ImageIcon size={24} />
                      </div>
                      <div>
                        <div style={{ color: '#0062ff', fontSize: 14, marginBottom: 4 }}>{line.item.name}</div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>SKU: {line.item.sku}</div>
                      </div>
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {line.qtyPerUnit} X {assembly.qty} assemblies
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {line.qty} {line.item.stockingUom?.unitName || ''}
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {formatMoney(line.unitValue)}
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14, textAlign: 'right' }}>
                      {formatMoney(getLineAmount(line))}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #eef0f3', background: '#f8fafc' }}>
                  <td style={{ padding: '16px', fontWeight: 600, color: '#1e293b' }}>Total</td>
                  <td style={{ padding: '16px' }} />
                  <td style={{ padding: '16px' }} />
                  <td style={{ padding: '16px' }} />
                  <td
                    style={{
                      padding: '16px',
                      color: '#1e293b',
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    {formatMoney(getSectionTotal(goodsItems))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {serviceItems.length > 0 && (
          <div>
            <h4 style={{ fontSize: 16, fontWeight: 500, color: '#1e293b', margin: '0 0 16px' }}>Services</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr
                  style={{
                    borderBottom: '2px solid #eef0f3',
                    color: '#64748b',
                    fontSize: 12,
                    textTransform: 'uppercase',
                  }}
                >
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Service Details</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Quantity Consumed</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Total Qty Consumed</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Cost Per Unit</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {serviceItems.map((line) => (
                  <tr key={line.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                    <td style={{ padding: '16px', display: 'flex', gap: 12 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          background: '#f8fafc',
                          border: '1px solid #eef0f3',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#cbd5e1',
                        }}
                      >
                        <ImageIcon size={24} />
                      </div>
                      <div>
                        <div style={{ color: '#0062ff', fontSize: 14, marginBottom: 4 }}>{line.item.name}</div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>SKU: {line.item.sku}</div>
                      </div>
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {line.qtyPerUnit} X {assembly.qty} assemblies
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {line.qty} {line.item.stockingUom?.unitName || ''}
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14 }}>
                      {formatMoney(line.unitValue)}
                    </td>
                    <td style={{ padding: '16px', color: '#334155', fontSize: 14, textAlign: 'right' }}>
                      {formatMoney(getLineAmount(line))}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #eef0f3', background: '#f8fafc' }}>
                  <td style={{ padding: '16px', fontWeight: 600, color: '#1e293b' }}>Total</td>
                  <td style={{ padding: '16px' }} />
                  <td style={{ padding: '16px' }} />
                  <td style={{ padding: '16px' }} />
                  <td
                    style={{
                      padding: '16px',
                      color: '#1e293b',
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: 'right',
                    }}
                  >
                    {formatMoney(getSectionTotal(serviceItems))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
