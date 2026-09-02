import { format } from 'date-fns';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBillById, getBillSignedUrl, deleteBill, updateBill, type BillAttachment } from './bills.api';
import { organizationsApi } from '../../organizations/organizations.api';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { X, Edit, ChevronDown, FileText, Paperclip, Copy, Trash2, Printer } from 'lucide-react';
import { useState, useRef, useEffect, Fragment } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { BillComments } from './BillComments';
import { BillActivityTimeline } from './BillActivityTimeline';
import { useTrackingLabel } from '../../../hooks/useTrackingLabel';

function BillAttachmentLink({ orgId, attachment }: { orgId: string; attachment: BillAttachment }) {
  const isDirectUrl = Boolean(attachment.data || attachment.url);
  const { data: signedUrl } = useQuery({
    queryKey: ['BillAttachmentSignedUrl', orgId, attachment.key],
    queryFn: () => getBillSignedUrl(orgId, attachment.key!),
    enabled: Boolean(orgId && attachment.key && !isDirectUrl),
    staleTime: 1000 * 60 * 30,
  });

  const finalUrl = isDirectUrl ? attachment.data || attachment.url : signedUrl;

  if (finalUrl) {
    return (
      <a
        href={finalUrl}
        download={attachment.name || 'attachment'}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#0062ff', textDecoration: 'none', fontWeight: 500 }}
      >
        {attachment.name || 'Attachment'}
      </a>
    );
  }

  return <span style={{ fontWeight: 500 }}>{attachment.name || 'Attachment'}</span>;
}

export function BillDetail({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const trackingLabel = useTrackingLabel();
  const [activeTab, setActiveTab] = useState('Overview');
  const [activeSubTab, setActiveSubTab] = useState<'Bills' | 'Receives'>('Bills');
  const [isPdfView, setIsPdfView] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isPdfMenuOpen, setIsPdfMenuOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isConfirmOpenBillVisible, setIsConfirmOpenBillVisible] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  const pdfTemplateRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    setIsPdfMenuOpen(false);
    setIsPdfView(true);
    setTimeout(async () => {
      if (pdfTemplateRef.current) {
        try {
          const html2pdfModule =
            (await import('html2pdf.js')).default ||
            (window as unknown as { html2pdf?: unknown }).html2pdf;
          const opt: Html2PdfOptions = {
            margin: [8, 8, 8, 8],
            filename: `${po?.billNumber || 'Bill'}.pdf`,
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

  useEffect(() => {
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

  const deleteMutation = useMutation({
    mutationFn: () => deleteBill(orgId!, poId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills', orgId] });
      setIsConfirmDeleteOpen(false);
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateBill,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bill', orgId, poId] });
      queryClient.invalidateQueries({ queryKey: ['bills', orgId] });
    },
  });

  const { data: po, isLoading } = useQuery({
    queryKey: ['bill', orgId, poId],
    queryFn: () => fetchBillById(orgId!, poId),
    enabled: Boolean(orgId && poId),
  });

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    enabled: Boolean(orgId),
  });
  const currentOrg = orgs?.find((o) => o.organizationId === orgId);

  if (isLoading) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Loading bill details...
      </div>
    );
  }

  if (!po) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Bill not found.
      </div>
    );
  }

  const tabs = ['Overview', 'Comments', 'Activity'];

  const labelStyle = {
    fontSize: '11px',
    color: '#64748b',
    marginBottom: '2px',
  };

  const valueStyle = {
    fontSize: '12px',
    color: '#1e293b',
    fontWeight: 500,
    marginBottom: '12px',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
      }}
    >
      {/* Header */}
      <div className="detail-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 className="detail-title" style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {po.billNumber}
          </h2>
          <span
            style={{
              background: po.status === 'draft' ? '#94a3b8' : '#3b82f6',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {po.status || 'Draft'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {po.status?.toLowerCase() === 'draft' && (
            <button
              onClick={() => setIsConfirmOpenBillVisible(true)}
              style={{
                padding: '6px 12px',
                border: '1px solid #15803d',
                background: '#15803d',
                color: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              Open Bill
            </button>
          )}

          <button className="action-btn"
            onClick={() => navigate(`/organizations/${orgId}/purchases/bills/${poId}/edit`, { state: { returnUrl: location.pathname + location.search } })}
            style={{
              padding: '6px 12px',
              border: '1px solid #d1d5db',
              background: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Edit size={14} /> <span className="action-btn-text">Edit</span>
          </button>

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button className="action-btn"
              onClick={() => setIsMoreOpen(!isMoreOpen)}
              style={{
                padding: '6px 12px',
                border: '1px solid #d1d5db',
                background: 'white',
                borderRadius: '4px',
                fontSize: '13px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span className="action-btn-text">More</span> <ChevronDown size={14} />
            </button>

            {isMoreOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'white',
                  border: '1px solid #eef0f3',
                  borderRadius: '4px',
                  boxShadow:
                    '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  width: '140px',
                  zIndex: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => {
                    setIsMoreOpen(false);
                    navigate(`/organizations/${orgId}/purchases/bills/new?cloneFrom=${poId}`);
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Copy size={14} /> Clone
                </div>
                <div
                  onClick={() => {
                    setIsMoreOpen(false);
                    setIsConfirmDeleteOpen(true);
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    color: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Trash2 size={14} /> Delete
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: '0 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {tabs.map((tab, idx) => (
            <Fragment key={tab}>
              {idx > 0 && <div style={{ height: '16px', width: '1px', background: '#cbd5e1' }} />}
              <div
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '12px 0',
                  fontSize: '14px',
                  fontWeight: activeTab === tab ? 600 : 500,
                  color: activeTab === tab ? '#0062ff' : '#64748b',
                  borderBottom: activeTab === tab ? '2px solid #0062ff' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                {tab}
              </div>
            </Fragment>
          ))}
        </div>

        {/* Vertical Divider */}
        <div style={{ height: '16px', width: '1px', background: '#cbd5e1' }} />

        {/* PDF / Print Dropdown next to Activity tab */}
        <div style={{ position: 'relative' }} ref={pdfMenuRef}>
          <button className="action-btn"
            onClick={() => setIsPdfMenuOpen(!isPdfMenuOpen)}
            style={{
              padding: '4px 8px',
              border: 'none',
              background: 'transparent',
              borderRadius: '4px',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#475569',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <FileText size={16} /> PDF/<span className="action-btn-text">Print</span> <ChevronDown size={14} />
          </button>

          {isPdfMenuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '4px',
                background: 'white',
                border: '1px solid #eef0f3',
                borderRadius: '4px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                width: '130px',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                onClick={handleDownloadPdf}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <FileText size={14} /> Download PDF
              </div>
              <div
                onClick={handlePrint}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Printer size={14} /> Print
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 0, background: '#f8fafc' }}>
        <div
          style={{
            display: activeTab === 'Overview' ? 'flex' : 'none',
            flexDirection: 'column',
            padding: '16px 24px',
          }}
        >
          {/* Bills / Receives Top Bar */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px 8px 0 0',
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #eef0f3',
            }}
          >
            <div style={{ display: 'flex', gap: '20px' }}>
              <button
                type="button"
                onClick={() => setActiveSubTab('Bills')}
                style={{
                  padding: '12px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom:
                    activeSubTab === 'Bills' ? '2px solid #0062ff' : '2px solid transparent',
                  color: activeSubTab === 'Bills' ? '#0062ff' : '#475569',
                  fontWeight: activeSubTab === 'Bills' ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Overview
              </button>
            </div>
          </div>

          {/* PDF View Toggle */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderTop: 'none',
              borderRadius: '0 0 8px 8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              marginBottom: '20px',
              fontSize: '13px',
            }}
          >
            {/* Toggle Switch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{ fontSize: '13px', fontStyle: 'italic', color: '#475569', fontWeight: 500 }}
              >
                Show PDF View
              </span>
              <label
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  width: '38px',
                  height: '20px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isPdfView}
                  onChange={(e) => setIsPdfView(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: isPdfView ? '#0062ff' : '#cbd5e1',
                    transition: '0.3s',
                    borderRadius: '20px',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    content: '""',
                    height: '14px',
                    width: '14px',
                    left: isPdfView ? '20px' : '3px',
                    bottom: '3px',
                    backgroundColor: 'white',
                    transition: '0.3s',
                    borderRadius: '50%',
                  }}
                />
              </label>
            </div>
          </div>

          {/* VIEW MODE 1: Standard Web View (isPdfView === false) */}
          {!isPdfView && (
            <div
              style={{
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '24px 32px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              {/* Header Title & Addresses */}
              <div className="detail-top-section">
                <div>
                  <h1
                    style={{
                      fontSize: '24px',
                      fontWeight: 700,
                      color: '#0f172a',
                      margin: '0 0 4px 0',
                    }}
                  >
                    BILL
                  </h1>
                  <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
                    BILL# <strong style={{ color: '#0f172a' }}>{po.billNumber}</strong>
                  </div>
                </div>

                <div className="detail-top-right">
                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        marginBottom: '6px',
                      }}
                    >
                      VENDOR ADDRESS
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#0062ff',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      {po.vendor?.contactName || po.vendor?.companyName || '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                      {po.vendor?.email && <div>{po.vendor.email}</div>}
                      {po.vendor?.phone && <div>{po.vendor.phone}</div>}
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        marginBottom: '6px',
                      }}
                    >
                      DELIVERY ADDRESS
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#0f172a',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      {po.location?.name || 'Head Office'}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#475569',
                        lineHeight: 1.5,
                        maxWidth: '220px',
                      }}
                    >
                      {po.location?.addressString}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status & Order Details Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: '20px',
                  marginBottom: '28px',
                  background: '#fafafa',
                  padding: '16px 20px',
                  borderRadius: '6px',
                  border: '1px solid #f1f5f9',
                }}
              >
                <div>
                  <div style={labelStyle}>STATUS</div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      marginTop: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          background: po.status === 'draft' ? '#94a3b8' : '#16a34a',
                          color: 'white',
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        {po.status || 'Draft'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>BILL DATE</div>
                  <div style={valueStyle}>
                    {po.billDate ? format(new Date(po.billDate), 'dd-MM-yyyy') : '-'}
                  </div>

                  <div style={{ ...labelStyle, marginTop: '8px' }}>DUE DATE</div>
                  <div style={valueStyle}>
                    {po.dueDate ? format(new Date(po.dueDate), 'dd-MM-yyyy') : '-'}
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>PAYMENT TERMS</div>
                  <div style={valueStyle}>-</div>

                  <div style={{ ...labelStyle, marginTop: '8px' }}>LOCATION</div>
                  <div style={valueStyle}>{po.location?.name || 'Head Office'}</div>
                </div>

                <div>
                  <div style={labelStyle}>Bill TYPE</div>
                  <div style={valueStyle}>Standard</div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="responsive-table-wrapper">
<table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      ITEMS & DESCRIPTION
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      QUANTITY
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'left',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      LOCATION
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      RATE
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      DISCOUNT
                    </th>
                    <th
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#64748b',
                      }}
                    >
                      AMOUNT
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(po.lineItems || []).map((item, index) => {
                    const discVal = Number(
                      item.discountValue !== undefined && item.discountValue !== null
                        ? item.discountValue
                        : item.discountPercentage || item.discountAmount || 0,
                    );
                    const discDisplay =
                      item.discountType === 'fixed' ? `₹${discVal.toFixed(2)}` : `${discVal}%`;

                    return (
                      <Fragment key={item.id || index}>
                        <tr
                          style={{
                            borderBottom:
                              item.batches && item.batches.length > 0
                                ? 'none'
                                : '1px solid #f1f5f9',
                          }}
                        >
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#0062ff',
                              fontWeight: 500,
                              verticalAlign: 'top',
                            }}
                          >
                            {item.item?.name || 'Item'}
                            {item.description && (
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                {item.description}
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#1e293b',
                              textAlign: 'center',
                              verticalAlign: 'top',
                            }}
                          >
                            {item.quantity} PCS
                          </td>
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#475569',
                              verticalAlign: 'top',
                            }}
                          >
                            {po.location?.name || 'Head Office'}
                          </td>
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#1e293b',
                              textAlign: 'right',
                              verticalAlign: 'top',
                            }}
                          >
                            ₹{Number(item.rate || 0).toFixed(2)}
                          </td>
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#475569',
                              textAlign: 'right',
                              verticalAlign: 'top',
                            }}
                          >
                            {discVal > 0 ? discDisplay : '₹0.00'}
                          </td>
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#0f172a',
                              textAlign: 'right',
                              fontWeight: 600,
                              verticalAlign: 'top',
                            }}
                          >
                            ₹
                            {Number(
                              (item as Record<string, unknown>).itemTotal || item.amount || 0,
                            ).toFixed(2)}
                          </td>
                        </tr>

                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
</div>





              {/* Totals & Notes Section */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '32px',
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: '20px',
                }}
              >
                <div style={{ flex: 1, fontSize: '13px', color: '#475569' }}>
                  {po.termsAndConditions && (
                    <div style={{ marginBottom: '16px' }}>
                      <strong
                        style={{ color: '#1e293b', fontSize: '12px', textTransform: 'uppercase' }}
                      >
                        Terms & Conditions:
                      </strong>
                      <div style={{ marginTop: '4px', lineHeight: 1.5, color: '#475569' }}>
                        {po.termsAndConditions}
                      </div>
                    </div>
                  )}

                  {po.attachments && Array.isArray(po.attachments) && po.attachments.length > 0 && (
                    <div>
                      <strong
                        style={{
                          fontSize: '12px',
                          color: '#475569',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          textTransform: 'uppercase',
                        }}
                      >
                        <Paperclip size={13} /> Attachments:
                      </strong>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                          marginTop: '8px',
                        }}
                      >
                        {po.attachments.map((att: BillAttachment, index: number) => (
                          <div
                            key={index}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '12px',
                              color: '#1e293b',
                            }}
                          >
                            <FileText size={14} color="#0062ff" />
                            <BillAttachmentLink orgId={orgId!} attachment={att} />
                            {att.size && (
                              <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                                ({(att.size / (1024 * 1024)).toFixed(2)} MB)
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    width: '280px',
                    background: '#f8fafc',
                    padding: '16px 20px',
                    borderRadius: '8px',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '10px',
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#64748b' }}>Sub Total</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      ₹{Number(po.subTotal || 0).toFixed(2)}
                    </span>
                  </div>
                  {Number(po.subTotal || 0) >
                    Number((po as Record<string, unknown>).total || po.totalAmount || 0) && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '10px',
                        fontSize: '13px',
                        color: '#16a34a',
                      }}
                    >
                      <span>Total Discount</span>
                      <span style={{ fontWeight: 600 }}>
                        -₹
                        {(
                          Number(po.subTotal || 0) -
                          Number((po as Record<string, unknown>).total || po.totalAmount || 0)
                        ).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '12px',
                      paddingTop: '12px',
                      borderTop: '1px solid #e2e8f0',
                      fontWeight: 700,
                      fontSize: '16px',
                      color: '#0f172a',
                    }}
                  >
                    <span>Total</span>
                    <span>
                      ₹
                      {Number(
                        (po as Record<string, unknown>).total || po.totalAmount || 0,
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* BATCH DETAILS SECTION */}
              {(po.lineItems || []).some(item => item.batches && item.batches.length > 0) && (
                <div
                  style={{
                    borderTop: '1px solid #f1f5f9',
                    paddingTop: '24px',
                    marginTop: '24px',
                  }}
                >
                  <h3 style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{trackingLabel.singular.toUpperCase()} DETAILS</h3>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                    <div className="responsive-table-wrapper">
<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b', width: '20%' }}>ITEM</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>SUPPLIER {trackingLabel.singular.toUpperCase()} REF</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>MANUFACTURER {trackingLabel.singular.toUpperCase()}#</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>MFG. DATE</th>
                          <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>EXPIRY DATE</th>
                          <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#64748b' }}>QUANTITY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(po.lineItems || []).filter(item => item.batches && item.batches.length > 0).map((item, itemIndex, arr) => {
                          const isLastItem = itemIndex === arr.length - 1;
                          return item.batches!.map((batch, bIndex) => {
                            const isFirstBatch = bIndex === 0;
                            const isLastBatch = bIndex === item.batches!.length - 1;
                            const needsBottomBorder = !isLastItem || !isLastBatch;

                            return (
                              <tr key={`${item.id}-${bIndex}`} style={{ borderBottom: needsBottomBorder ? '1px solid #f1f5f9' : 'none' }}>
                                {isFirstBatch && (
                                  <td rowSpan={item.batches!.length} style={{ padding: '12px 16px', color: '#0f172a', fontWeight: 500, verticalAlign: 'top', borderRight: '1px solid #f1f5f9', background: '#fff' }}>
                                    {item.item?.name || 'Item'}
                                  </td>
                                )}
                                <td style={{ padding: '12px 16px', color: '#1e293b' }}>{batch.supplierBatchRef || '-'}</td>
                                <td style={{ padding: '12px 16px', color: '#1e293b' }}>{batch.manufacturerBatch || '-'}</td>
                                <td style={{ padding: '12px 16px', color: '#475569' }}>{batch.manufacturedDate ? format(new Date(batch.manufacturedDate), 'dd-MMM-yyyy') : '-'}</td>
                                <td style={{ padding: '12px 16px', color: '#475569' }}>{batch.expiryDate ? format(new Date(batch.expiryDate), 'dd-MMM-yyyy') : '-'}</td>
                                <td style={{ padding: '12px 16px', color: '#0f172a', textAlign: 'right', fontWeight: 600 }}>{batch.quantity}</td>
                              </tr>
                            );
                          });
                        })}
                      </tbody>
                    </table>
</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW MODE 2: Printable PDF View (isPdfView === true) */}
          {isPdfView && (
            <div
              ref={pdfTemplateRef}
              className="po-print-template"
              style={{
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: '4px',
                padding: '36px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                maxWidth: '850px',
                margin: '0 auto',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {/* PDF Header Table Grid */}
              <div className="responsive-table-wrapper">
<table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #000',
                  marginBottom: '-1px',
                }}
              >
                <tbody>
                  <tr>
                    <td
                      style={{
                        width: '50%',
                        padding: '12px',
                        verticalAlign: 'top',
                        borderRight: '1px solid #000',
                      }}
                    >
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#000' }}>
                        {currentOrg?.name || 'Company Name'}
                      </div>
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#333',
                          marginTop: '4px',
                          lineHeight: 1.4,
                        }}
                      >
                        {currentOrg?.address?.streetAddress1 && (
                          <>
                            {currentOrg.address.streetAddress1}
                            <br />
                          </>
                        )}
                        {currentOrg?.address?.city ||
                        currentOrg?.address?.stateCode ||
                        currentOrg?.address?.zip ? (
                          <>
                            {[
                              currentOrg.address.city,
                              currentOrg.address.stateCode,
                              currentOrg.address.zip,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            <br />
                          </>
                        ) : null}
                        {currentOrg?.address?.country && <>{currentOrg.address.country}</>}
                      </div>
                    </td>
                    <td
                      style={{
                        width: '50%',
                        padding: '12px',
                        verticalAlign: 'middle',
                        textAlign: 'right',
                      }}
                    >
                      <h2 className="detail-title"
                        style={{
                          fontSize: '26px',
                          fontWeight: 800,
                          color: '#000',
                          margin: 0,
                          letterSpacing: '1px',
                        }}
                      >
                        BILL
                      </h2>
                    </td>
                  </tr>
                </tbody>
              </table>
</div>

              {/* PDF Bill Meta Table */}
              <div className="responsive-table-wrapper">
<table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #000',
                  marginBottom: '-1px',
                  fontSize: '11px',
                }}
              >
                <tbody>
                  <tr>
                    <td
                      style={{ width: '50%', padding: '6px 10px', borderRight: '1px solid #000' }}
                    >
                      <strong>Bill No.</strong> : <strong>{po.billNumber}</strong>
                    </td>
                    <td style={{ width: '50%', padding: '6px 10px' }}>
                      <strong>Place Of Supply</strong> : Gujarat (24)
                    </td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #000' }}>
                    <td
                      style={{ width: '50%', padding: '6px 10px', borderRight: '1px solid #000' }}
                    >
                      <strong>Date</strong> :{' '}
                      {po.billDate ? format(new Date(po.billDate), 'dd-MM-yyyy') : '-'}
                    </td>
                    <td style={{ width: '50%', padding: '6px 10px' }}>
                      <strong>Terms</strong> : -
                    </td>
                  </tr>
                </tbody>
              </table>
</div>

              {/* Vendor & Delivery Address Grid */}
              <div className="responsive-table-wrapper">
<table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #000',
                  marginBottom: '-1px',
                  fontSize: '11px',
                }}
              >
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #000' }}>
                    <th
                      style={{
                        width: '50%',
                        padding: '6px 10px',
                        textAlign: 'left',
                        borderRight: '1px solid #000',
                      }}
                    >
                      Vendor Address
                    </th>
                    <th style={{ width: '50%', padding: '6px 10px', textAlign: 'left' }}>
                      Deliver To
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      style={{
                        padding: '10px',
                        verticalAlign: 'top',
                        borderRight: '1px solid #000',
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>{po.vendor?.contactName || po.vendor?.companyName || '-'}</strong>
                      {po.vendor?.email && <div>{po.vendor.email}</div>}
                      {po.vendor?.phone && <div>{po.vendor.phone}</div>}
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'top', lineHeight: 1.5 }}>
                      <strong>{po.location?.name || 'Head Office'}</strong>
                      <div>{po.location?.addressString}</div>
                    </td>
                  </tr>
                </tbody>
              </table>
</div>

              {/* PDF Items Table */}
              <div className="responsive-table-wrapper">
<table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #000',
                  marginBottom: '-1px',
                  fontSize: '11px',
                }}
              >
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #000' }}>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'center',
                        width: '35px',
                      }}
                    >
                      S No
                    </th>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'left',
                      }}
                    >
                      Material Code & Description
                    </th>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'center',
                        width: '85px',
                      }}
                    >
                      Delivery Date
                    </th>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'center',
                        width: '65px',
                      }}
                    >
                      Qty (UoM)
                    </th>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'right',
                        width: '85px',
                      }}
                    >
                      Unit Rate (INR)
                    </th>
                    <th
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid #000',
                        textAlign: 'right',
                        width: '65px',
                      }}
                    >
                      Discount
                    </th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', width: '95px' }}>
                      Total Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(po.lineItems || []).map((item, index) => {
                    const discVal = Number(
                      item.discountValue !== undefined && item.discountValue !== null
                        ? item.discountValue
                        : item.discountPercentage || item.discountAmount || 0,
                    );
                    const discDisplay =
                      item.discountType === 'fixed' ? `₹${discVal.toFixed(2)}` : `${discVal}%`;

                    return (
                      <tr key={item.id || index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td
                          style={{
                            padding: '8px',
                            borderRight: '1px solid #000',
                            textAlign: 'center',
                          }}
                        >
                          {index + 1}
                        </td>
                        <td
                          style={{ padding: '8px', borderRight: '1px solid #000', fontWeight: 600 }}
                        >
                          {item.item?.name || 'Item'}
                          {item.description && (
                            <div style={{ fontWeight: 400, color: '#475569', marginTop: '2px' }}>
                              {item.description}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            borderRight: '1px solid #000',
                            textAlign: 'center',
                          }}
                        >
                          {po.dueDate ? format(new Date(po.dueDate), 'dd-MM-yyyy') : '-'}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            borderRight: '1px solid #000',
                            textAlign: 'center',
                          }}
                        >
                          {item.quantity}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            borderRight: '1px solid #000',
                            textAlign: 'right',
                          }}
                        >
                          ₹{Number(item.rate || 0).toFixed(2)}
                        </td>
                        <td
                          style={{
                            padding: '8px',
                            borderRight: '1px solid #000',
                            textAlign: 'right',
                          }}
                        >
                          {discVal > 0 ? discDisplay : '₹0.00'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                          ₹
                          {Number(
                            (item as Record<string, unknown>).itemTotal || item.amount || 0,
                          ).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
</div>



              {/* PDF Totals & Signatures Grid */}
              <div className="responsive-table-wrapper">
<table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  border: '1px solid #000',
                  fontSize: '11px',
                }}
              >
                <tbody>
                  <tr>
                    <td
                      style={{
                        width: '60%',
                        padding: '12px',
                        verticalAlign: 'top',
                        borderRight: '1px solid #000',
                      }}
                    >
                      {po.termsAndConditions && (
                        <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          <strong>Terms & Conditions:</strong>
                          <br />
                          {po.termsAndConditions}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        width: '40%',
                        padding: '12px',
                        verticalAlign: 'top',
                        textAlign: 'right',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '8px',
                        }}
                      >
                        <span>Sub Total:</span>
                        <strong>₹{Number(po.subTotal || 0).toFixed(2)}</strong>
                      </div>
                      {Number(po.subTotal || 0) >
                        Number((po as Record<string, unknown>).total || po.totalAmount || 0) && (
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '8px',
                            color: '#16a34a',
                          }}
                        >
                          <span>Total Discount:</span>
                          <strong>
                            -₹
                            {(
                              Number(po.subTotal || 0) -
                              Number((po as Record<string, unknown>).total || po.totalAmount || 0)
                            ).toFixed(2)}
                          </strong>
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderTop: '1px solid #000',
                          paddingTop: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                        }}
                      >
                        <span>Total:</span>
                        <strong>
                          ₹
                          {Number(
                            (po as Record<string, unknown>).total || po.totalAmount || 0,
                          ).toFixed(2)}
                        </strong>
                      </div>

                      <div style={{ marginTop: '40px', fontSize: '11px', color: '#333' }}>
                        <div>For, {currentOrg?.name || 'Company Name'}</div>
                        <div style={{ marginTop: '30px', fontWeight: 600 }}>
                          Authorized Signature
                        </div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
</div>

              {/* PDF Batch Details Section */}
              {(po.lineItems || []).some(item => item.batches && item.batches.length > 0) && (
                <div style={{ marginTop: '16px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#000', marginBottom: '6px' }}>{trackingLabel.singular.toUpperCase()} DETAILS</div>
                  <div className="responsive-table-wrapper">
<table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '10px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #000' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #000', width: '25%' }}>Item</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #000' }}>Supplier {trackingLabel.singular} Ref</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #000' }}>Manufacturer {trackingLabel.singular}#</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #000' }}>Mfg. Date</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', borderRight: '1px solid #000' }}>Expiry Date</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(po.lineItems || []).filter(item => item.batches && item.batches.length > 0).map((item) => {
                        return item.batches!.map((batch, bIndex) => {
                          const isFirstBatch = bIndex === 0;
                          return (
                            <tr key={`${item.id}-${bIndex}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                              {isFirstBatch && (
                                <td rowSpan={item.batches!.length} style={{ padding: '6px 8px', borderRight: '1px solid #000', verticalAlign: 'top', fontWeight: 600 }}>
                                  {item.item?.name || 'Item'}
                                </td>
                              )}
                              <td style={{ padding: '6px 8px', borderRight: '1px solid #000' }}>{batch.supplierBatchRef || '-'}</td>
                              <td style={{ padding: '6px 8px', borderRight: '1px solid #000' }}>{batch.manufacturerBatch || '-'}</td>
                              <td style={{ padding: '6px 8px', borderRight: '1px solid #000' }}>{batch.manufacturedDate ? format(new Date(batch.manufacturedDate), 'dd-MMM-yyyy') : '-'}</td>
                              <td style={{ padding: '6px 8px', borderRight: '1px solid #000' }}>{batch.expiryDate ? format(new Date(batch.expiryDate), 'dd-MMM-yyyy') : '-'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{batch.quantity}</td>
                            </tr>
                          );
                        });
                      })}
                    </tbody>
                  </table>
</div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: activeTab === 'Comments' ? 'block' : 'none', padding: '16px' }}>
          <BillComments orgId={orgId!} poId={poId} />
        </div>
        <div style={{ display: activeTab === 'Activity' ? 'block' : 'none', padding: '16px' }}>
          <BillActivityTimeline orgId={orgId!} poId={poId} />
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        title="Delete BILL"
        message={`Are you sure you want to delete BILL ${po.billNumber}? This action cannot be undone.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        isOpen={isConfirmOpenBillVisible}
        title="Open Bill"
        message="Are you sure you want to open this bill? Stock will be updated."
        confirmText={updateMutation.isPending ? 'Opening...' : 'Open Bill'}
        onConfirm={() => {
          updateMutation.mutate({
            orgId: orgId!,
            id: poId,
            data: { status: 'Open' },
          });
          setIsConfirmOpenBillVisible(false);
        }}
        onCancel={() => setIsConfirmOpenBillVisible(false)}
      />
    </div>
  );
}
