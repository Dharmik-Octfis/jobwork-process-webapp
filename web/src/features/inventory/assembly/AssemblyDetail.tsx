import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  FileText,
  ChevronDown,
  Info,
  Image as ImageIcon,
  Trash2,
} from 'lucide-react';
import { assembliesApi } from './assemblies.api';
import { formatDate } from '../../../lib/formatDate';
import { AssemblyComments } from './AssemblyComments';
import { AssemblyActivityTimeline } from './AssemblyActivityTimeline';

interface Html2PdfOptions {
  margin?: number | [number, number] | [number, number, number, number];
  filename?: string;
  image?: {
    type?: 'jpeg' | 'png' | 'webp';
    quality?: number;
  };
  enableLinks?: boolean;
  html2canvas?: object;
  jsPDF?: {
    unit?: string;
    format?: string | [number, number];
    orientation?: 'portrait' | 'landscape';
  };
}

interface AssemblyDetailProps {
  orgId: string;
  assemblyId: string;
  onClose: () => void;
}

export function AssemblyDetail({ orgId, assemblyId, onClose }: AssemblyDetailProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'Overview' | 'Comment' | 'History'>('Overview');
  const [isPdfView, setIsPdfView] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isPdfMenuOpen, setIsPdfMenuOpen] = useState(false);
  const moreMenuRef = React.useRef<HTMLDivElement>(null);
  const pdfMenuRef = React.useRef<HTMLDivElement>(null);
  const pdfTemplateRef = React.useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    setIsPdfMenuOpen(false);
    setIsPdfView(true);
    setTimeout(async () => {
      if (pdfTemplateRef.current) {
        try {
          const html2pdfModule = (await import('html2pdf.js')).default || (window as unknown as { html2pdf?: unknown }).html2pdf;
          const opt: Html2PdfOptions = {
            margin: [8, 8, 8, 8],
            filename: `${assembly?.assemblyNumber || 'Assembly'}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          };
          if (typeof html2pdfModule === 'function') {
            html2pdfModule().set(opt).from(pdfTemplateRef.current).save();
          } else {
            window.print();
          }
        } catch (err) {
          console.error('PDF generation error:', err);
          window.print();
        }
      }
    }, 150);
  };

  const handlePrint = () => {
    setIsPdfMenuOpen(false);
    setIsPdfView(true);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
      if (pdfMenuRef.current && !pdfMenuRef.current.contains(event.target as Node)) {
        setIsPdfMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this assembly?')) {
      await assembliesApi.deleteAssembly(orgId, assemblyId);
      queryClient.invalidateQueries({ queryKey: ['assemblies', orgId] });
      queryClient.invalidateQueries({ queryKey: ['assemblies-count', orgId] });
      onClose();
    }
  };

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
  const grandTotal = getSectionTotal(goodsItems) + getSectionTotal(serviceItems);

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
          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 12px',
                border: '1px solid #eef0f3',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
                color: '#334155',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              More
              <ChevronDown size={14} />
            </button>
            {isMoreOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: '#fff',
                  border: '1px solid #eef0f3',
                  borderRadius: 6,
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
                  zIndex: 10,
                  minWidth: 160,
                  padding: 4,
                }}
              >
                <button
                  onClick={handleDelete}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    background: 'transparent',
                    color: '#ef4444',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'left',
                    borderRadius: 4,
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            )}
          </div>
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
        <div style={{ position: 'relative' }} ref={pdfMenuRef}>
          <button
            type="button"
            onClick={() => setIsPdfMenuOpen(!isPdfMenuOpen)}
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
          {isPdfMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: '#fff',
                border: '1px solid #eef0f3',
                borderRadius: 6,
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                zIndex: 10,
                minWidth: 160,
                padding: 4,
              }}
            >
              <button
                onClick={handleDownloadPdf}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: '#334155',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: 4,
                }}
              >
                <FileText size={14} />
                PDF
              </button>
              <button
                onClick={handlePrint}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: 'transparent',
                  color: '#334155',
                  fontSize: 13,
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: 4,
                }}
              >
                <FileText size={14} />
                Print
              </button>
            </div>
          )}
        </div>
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

      <div style={{ flex: 1, overflow: 'auto', padding: 24, display: isPdfView ? 'none' : 'block' }}>
        {activeTab === 'History' && (
          <AssemblyActivityTimeline orgId={orgId} assemblyId={assemblyId} />
        )}
        {activeTab === 'Comment' && (
          <AssemblyComments orgId={orgId} assemblyId={assemblyId} />
        )}
        {activeTab === 'Overview' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 500, color: '#1e293b', margin: 0 }}>
                ASSEMBLY DETAILS
              </h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#334155', fontWeight: 500, fontStyle: 'italic' }}>
                Show PDF View
                <div
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: isPdfView ? '#e2e8f0' : '#e2e8f0', // In screenshot it's gray when off.
                    position: 'relative',
                    transition: 'background 0.2s',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: isPdfView ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      transition: 'left 0.2s',
                    }}
                  />
                </div>
                <input
                  type="checkbox"
                  checked={isPdfView}
                  onChange={(e) => setIsPdfView(e.target.checked)}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 32px' }}>
              Assembly# <span style={{ fontWeight: 600, color: '#1e293b' }}>{assembly.assemblyNumber}</span>
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
                {formatMoney(grandTotal)}
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
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Total</th>
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
                  <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Total</th>
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
          </>
        )}
      </div>

      {isPdfView && (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: '#f1f5f9',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ marginBottom: '16px', display: 'flex', gap: '16px', width: '210mm', justifyContent: 'flex-end', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#334155', fontWeight: 500, fontStyle: 'italic', marginRight: 'auto' }}>
              Show PDF View
              <div
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: isPdfView ? '#0062ff' : '#e2e8f0',
                  position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 2,
                    left: isPdfView ? 18 : 2,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    transition: 'left 0.2s',
                  }}
                />
              </div>
              <input
                type="checkbox"
                checked={isPdfView}
                onChange={(e) => setIsPdfView(e.target.checked)}
                style={{ display: 'none' }}
              />
            </label>
            <button
              onClick={handleDownloadPdf}
              style={{
                padding: '6px 12px',
                border: '1px solid transparent',
                background: '#0062ff',
                color: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Download PDF
            </button>
            <button
              onClick={handlePrint}
              style={{
                padding: '6px 12px',
                border: '1px solid transparent',
                background: '#0062ff',
                color: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Print
            </button>
          </div>
          <div
            ref={pdfTemplateRef}
            className="print-section"
            style={{
              width: '210mm',
              minHeight: '297mm',
              background: '#fff',
              padding: '20mm',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
              <div>
                <h1 style={{ fontSize: '28px', color: '#1e293b', margin: '0 0 8px 0' }}>ASSEMBLY</h1>
                <div style={{ color: '#64748b', fontSize: '14px' }}>#{assembly.assemblyNumber}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#1e293b', fontWeight: 600 }}>Assembled Date</div>
                <div style={{ color: '#64748b' }}>{formatDate(assembly.assemblyDate)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '40px', marginBottom: '40px' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}>Composite Item</div>
                <div style={{ color: '#1e293b', fontWeight: 600 }}>{assembly.compositeItem?.name}</div>
                <div style={{ color: '#64748b', fontSize: '14px' }}>{assembly.compositeItem?.sku}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}>Quantity</div>
                <div style={{ color: '#1e293b', fontWeight: 600 }}>{assembly.qty}</div>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}>Location</div>
                <div style={{ color: '#1e293b', fontWeight: 600 }}>{assembly.location?.name || '-'}</div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '40px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '12px', color: '#475569', fontSize: '12px' }}>ITEM</th>
                  <th style={{ textAlign: 'right', padding: '12px', color: '#475569', fontSize: '12px' }}>QTY CONSUMED</th>
                  <th style={{ textAlign: 'right', padding: '12px', color: '#475569', fontSize: '12px' }}>COST PER UNIT</th>
                  <th style={{ textAlign: 'right', padding: '12px', color: '#475569', fontSize: '12px' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {assembly.lines.map((line) => (
                  <tr key={line.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ color: '#1e293b', fontWeight: 500 }}>{line.item.name}</div>
                      <div style={{ color: '#64748b', fontSize: '12px' }}>{line.item.sku}</div>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#1e293b' }}>
                      {line.qty} {line.item.stockingUom?.unitName}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#1e293b' }}>
                      {formatMoney(line.unitValue)}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#1e293b' }}>
                      {formatMoney(getLineAmount(line))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ width: '300px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: '2px solid #e2e8f0' }}>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>Total Value</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{formatMoney(grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
