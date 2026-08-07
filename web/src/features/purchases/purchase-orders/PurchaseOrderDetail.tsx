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
import { fetchPurchaseOrderById, getPOSignedUrl, deletePurchaseOrder, type POAttachment } from './purchase-orders.api';
import { fetchPaymentTerms } from './payment-terms.api';
import { organizationsApi } from '../../organizations/organizations.api';
import { useParams, useNavigate } from 'react-router-dom';
import { X, Edit, ChevronDown, FileText, Paperclip, Copy, Trash2, Printer } from 'lucide-react';
import { useState, useRef, useEffect, Fragment } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { PurchaseOrderComments } from './PurchaseOrderComments';
import { PurchaseOrderActivityTimeline } from './PurchaseOrderActivityTimeline';

function POAttachmentLink({ orgId, attachment }: { orgId: string; attachment: POAttachment }) {
  const isDirectUrl = Boolean(attachment.data || attachment.url);
  const { data: signedUrl } = useQuery({
    queryKey: ['poAttachmentSignedUrl', orgId, attachment.key],
    queryFn: () => getPOSignedUrl(orgId, attachment.key!),
    enabled: Boolean(orgId && attachment.key && !isDirectUrl),
    staleTime: 1000 * 60 * 30,
  });

  const finalUrl = isDirectUrl ? (attachment.data || attachment.url) : signedUrl;

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

export function PurchaseOrderDetail({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Overview');
  const [activeSubTab, setActiveSubTab] = useState<'Bills' | 'Receives'>('Bills');
  const [isPdfView, setIsPdfView] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isPdfMenuOpen, setIsPdfMenuOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  const pdfTemplateRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    setIsPdfMenuOpen(false);
    setIsPdfView(true);
    setTimeout(async () => {
      if (pdfTemplateRef.current) {
        try {
          const html2pdfModule = (await import('html2pdf.js')).default || (window as unknown as { html2pdf?: unknown }).html2pdf;
          const opt: Html2PdfOptions = {
            margin: [8, 8, 8, 8],
            filename: `${po?.purchaseorder_number || 'PO'}.pdf`,
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
    mutationFn: () => deletePurchaseOrder(orgId!, poId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrders', orgId] });
      setIsConfirmDeleteOpen(false);
      onClose();
    },
  });

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchaseOrder', orgId, poId],
    queryFn: () => fetchPurchaseOrderById(orgId!, poId),
    enabled: Boolean(orgId && poId),
  });

  const { data: paymentTerms } = useQuery({
    queryKey: ['paymentTerms', orgId],
    queryFn: () => fetchPaymentTerms(orgId!),
    enabled: Boolean(orgId),
  });

  const { data: orgs } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
    enabled: Boolean(orgId),
  });
  const currentOrg = orgs?.find((o) => o.organizationId === orgId);

  const getPaymentTermLabel = (termVal?: string | null) => {
    if (!termVal) return '-';
    const found = paymentTerms?.find((pt) => pt.id.toString() === termVal || pt.termName === termVal);
    return found ? found.termName : termVal;
  };

  if (isLoading) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Loading purchase order details...
      </div>
    );
  }

  if (!po) {
    return (
      <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', color: '#64748b' }}>
        Purchase Order not found.
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
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {po.purchaseorder_number}
          </h2>
          <span
            style={{
              background: po.status === 'draft' ? '#94a3b8' : '#3b82f6',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 500,
              textTransform: 'capitalize'
            }}
          >
            {po.status || 'Draft'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => navigate(`/organizations/${orgId}/purchases/purchase-orders/${poId}/edit`)}
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
            <Edit size={14} /> Edit
          </button>

          <div style={{ position: 'relative' }} ref={moreMenuRef}>
            <button
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
              More <ChevronDown size={14} />
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
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
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
                    navigate(`/organizations/${orgId}/purchases/purchase-orders/new?cloneFrom=${poId}`);
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
      <div style={{ padding: '0 24px', borderBottom: '1px solid #eef0f3', display: 'flex', alignItems: 'center', gap: '16px' }}>
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
          <button
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
            <FileText size={16} /> PDF/Print <ChevronDown size={14} />
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
        <div style={{ display: activeTab === 'Overview' ? 'flex' : 'none', flexDirection: 'column', padding: '16px 24px' }}>

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
                  borderBottom: activeSubTab === 'Bills' ? '2px solid #0062ff' : '2px solid transparent',
                  color: activeSubTab === 'Bills' ? '#0062ff' : '#475569',
                  fontWeight: activeSubTab === 'Bills' ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Bills <span style={{ background: '#eff6ff', color: '#0062ff', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>0</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('Receives')}
                style={{
                  padding: '12px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeSubTab === 'Receives' ? '2px solid #0062ff' : '2px solid transparent',
                  color: activeSubTab === 'Receives' ? '#0062ff' : '#475569',
                  fontWeight: activeSubTab === 'Receives' ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Receives <span style={{ background: '#f1f5f9', color: '#64748b', padding: '1px 6px', borderRadius: '10px', fontSize: '11px' }}>0</span>
              </button>
            </div>
          </div>

          {/* Status Bar & PDF View Toggle */}
          <div
            style={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderTop: 'none',
              borderRadius: '0 0 8px 8px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '20px',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#475569' }}>
              <span>
                Receive Status : <strong style={{ color: '#64748b' }}>YET TO BE RECEIVED</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>|</span>
              <span>
                Bill Status : <strong style={{ color: '#16a34a' }}>UNBILLED</strong>
              </span>
            </div>

            {/* Toggle Switch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontStyle: 'italic', color: '#475569', fontWeight: 500 }}>
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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '28px',
                  borderBottom: '1px solid #f1f5f9',
                  paddingBottom: '20px',
                }}
              >
                <div>
                  <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
                    PURCHASE ORDER
                  </h1>
                  <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
                    Purchase Order# <strong style={{ color: '#0f172a' }}>{po.purchaseorder_number}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '48px' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                      VENDOR ADDRESS
                    </div>
                    <div style={{ fontSize: '13px', color: '#0062ff', fontWeight: 600, marginBottom: '2px' }}>
                      {po.vendor?.contactName || po.vendor?.companyName || '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
                      {po.vendor?.email && <div>{po.vendor.email}</div>}
                      {po.vendor?.phone && <div>{po.vendor.phone}</div>}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '6px' }}>
                      DELIVERY ADDRESS
                    </div>
                    <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600, marginBottom: '2px' }}>
                      {po.delivery_type === 'Location'
                        ? po.deliveryLocation?.name || 'Head Office'
                        : po.deliveryCustomer?.contactName || '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5, maxWidth: '220px' }}>
                      {po.delivery_type === 'Location' && po.deliveryLocation?.address}
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#475569' }}>Order:</span>
                      <span
                        style={{
                          background: po.status === 'draft' ? '#94a3b8' : '#16a34a',
                          color: 'white',
                          fontSize: '10px',
                          padding: '1px 6px',
                          borderRadius: '3px',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        {po.status || 'Draft'}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>Receive: <span style={{ color: '#64748b' }}>Yet To Be Received</span></div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>Bill: <span style={{ color: '#16a34a' }}>Unbilled</span></div>
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>ORDER DATE</div>
                  <div style={valueStyle}>{po.date ? format(new Date(po.date), 'dd-MM-yyyy') : '-'}</div>

                  <div style={{ ...labelStyle, marginTop: '8px' }}>DELIVERY DATE</div>
                  <div style={valueStyle}>{po.delivery_date ? format(new Date(po.delivery_date), 'dd-MM-yyyy') : '-'}</div>
                </div>

                <div>
                  <div style={labelStyle}>PAYMENT TERMS</div>
                  <div style={valueStyle}>{getPaymentTermLabel(po.payment_terms)}</div>

                  <div style={{ ...labelStyle, marginTop: '8px' }}>DELIVERY TYPE</div>
                  <div style={valueStyle}>{po.delivery_type || 'Location'}</div>
                </div>

                <div>
                  <div style={labelStyle}>PO TYPE</div>
                  <div style={valueStyle}>Standard</div>
                </div>
              </div>

              {/* Line Items Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '24px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>ITEMS & DESCRIPTION</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>ORDERED</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>LOCATION</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>RATE</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>DISCOUNT</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: '#64748b' }}>AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.line_items || []).map((item, index) => {
                    const discVal = Number(item.discountValue !== undefined && item.discountValue !== null ? item.discountValue : item.discount_percentage || item.discount || 0);
                    const discDisplay = item.discountType === 'fixed' ? `₹${discVal.toFixed(2)}` : `${discVal}%`;

                    return (
                      <tr key={item.id || item.line_item_id || index} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#0062ff', fontWeight: 500, verticalAlign: 'top' }}>
                          {item.item?.name || 'Item'}
                          {item.description && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{item.description}</div>}
                        </td>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#1e293b', textAlign: 'center', verticalAlign: 'top' }}>
                          {item.quantity} PCS
                        </td>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#475569', verticalAlign: 'top' }}>
                          {po.deliveryLocation?.name || 'Head Office'}
                        </td>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#1e293b', textAlign: 'right', verticalAlign: 'top' }}>
                          ₹{Number(item.rate || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#475569', textAlign: 'right', verticalAlign: 'top' }}>
                          {discVal > 0 ? discDisplay : '₹0.00'}
                        </td>
                        <td style={{ padding: '14px 12px', fontSize: '13px', color: '#0f172a', textAlign: 'right', fontWeight: 600, verticalAlign: 'top' }}>
                          ₹{Number(item.item_total || 0).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Totals & Notes Section */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '32px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                <div style={{ flex: 1, fontSize: '13px', color: '#475569' }}>
                  {po.notes && (
                    <div style={{ marginBottom: '16px' }}>
                      <strong style={{ color: '#1e293b', fontSize: '12px', textTransform: 'uppercase' }}>Notes:</strong>
                      <div style={{ marginTop: '4px', lineHeight: 1.5, color: '#475569' }}>{po.notes}</div>
                    </div>
                  )}

                  {po.terms && (
                    <div style={{ marginBottom: '16px' }}>
                      <strong style={{ color: '#1e293b', fontSize: '12px', textTransform: 'uppercase' }}>Terms & Conditions:</strong>
                      <div style={{ marginTop: '4px', lineHeight: 1.5, color: '#475569' }}>{po.terms}</div>
                    </div>
                  )}

                  {po.documents && Array.isArray(po.documents) && po.documents.length > 0 && (
                    <div>
                      <strong style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                        <Paperclip size={13} /> Attachments:
                      </strong>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                        {po.documents.map((att: POAttachment, index: number) => (
                          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#1e293b' }}>
                            <FileText size={14} color="#0062ff" />
                            <POAttachmentLink orgId={orgId!} attachment={att} />
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

                <div style={{ width: '280px', background: '#f8fafc', padding: '16px 20px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '13px' }}>
                    <span style={{ color: '#64748b' }}>Sub Total</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>₹{Number(po.sub_total || 0).toFixed(2)}</span>
                  </div>
                  {Number(po.sub_total || 0) > Number(po.total || 0) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '13px', color: '#16a34a' }}>
                      <span>Total Discount</span>
                      <span style={{ fontWeight: 600 }}>-₹{(Number(po.sub_total) - Number(po.total)).toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0', fontWeight: 700, fontSize: '16px', color: '#0f172a' }}>
                    <span>Total</span>
                    <span>₹{Number(po.total || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>
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
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', marginBottom: '-1px' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '50%', padding: '12px', verticalAlign: 'top', borderRight: '1px solid #000' }}>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#000' }}>
                        {currentOrg?.name || 'Company Name'}
                      </div>
                      <div style={{ fontSize: '11px', color: '#333', marginTop: '4px', lineHeight: 1.4 }}>
                        {currentOrg?.address?.streetAddress1 && <>{currentOrg.address.streetAddress1}<br /></>}
                        {currentOrg?.address?.city || currentOrg?.address?.stateCode || currentOrg?.address?.zip ? (
                          <>
                            {[currentOrg.address.city, currentOrg.address.stateCode, currentOrg.address.zip].filter(Boolean).join(' ')}<br />
                          </>
                        ) : null}
                        {currentOrg?.address?.country && <>{currentOrg.address.country}</>}
                      </div>
                    </td>
                    <td style={{ width: '50%', padding: '12px', verticalAlign: 'middle', textAlign: 'right' }}>
                      <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#000', margin: 0, letterSpacing: '1px' }}>
                        PURCHASE ORDER
                      </h2>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* PDF PO Meta Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', marginBottom: '-1px', fontSize: '11px' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '50%', padding: '6px 10px', borderRight: '1px solid #000' }}>
                      <strong>PO No.</strong> : <strong>{po.purchaseorder_number}</strong>
                    </td>
                    <td style={{ width: '50%', padding: '6px 10px' }}>
                      <strong>Place Of Supply</strong> : Gujarat (24)
                    </td>
                  </tr>
                  <tr style={{ borderTop: '1px solid #000' }}>
                    <td style={{ width: '50%', padding: '6px 10px', borderRight: '1px solid #000' }}>
                      <strong>Date</strong> : {po.date ? format(new Date(po.date), 'dd-MM-yyyy') : '-'}
                    </td>
                    <td style={{ width: '50%', padding: '6px 10px' }}>
                      <strong>Terms</strong> : {getPaymentTermLabel(po.payment_terms)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Vendor & Delivery Address Grid */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', marginBottom: '-1px', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #000' }}>
                    <th style={{ width: '50%', padding: '6px 10px', textAlign: 'left', borderRight: '1px solid #000' }}>Vendor Address</th>
                    <th style={{ width: '50%', padding: '6px 10px', textAlign: 'left' }}>Deliver To</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '10px', verticalAlign: 'top', borderRight: '1px solid #000', lineHeight: 1.5 }}>
                      <strong>{po.vendor?.contactName || po.vendor?.companyName || '-'}</strong>
                      {po.vendor?.email && <div>{po.vendor.email}</div>}
                      {po.vendor?.phone && <div>{po.vendor.phone}</div>}
                    </td>
                    <td style={{ padding: '10px', verticalAlign: 'top', lineHeight: 1.5 }}>
                      <strong>
                        {po.delivery_type === 'Location'
                          ? po.deliveryLocation?.name || 'Head Office'
                          : po.deliveryCustomer?.contactName || '-'}
                      </strong>
                      {po.delivery_type === 'Location' && <div>{po.deliveryLocation?.address}</div>}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* PDF Items Table */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', marginBottom: '-1px', fontSize: '11px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #000' }}>
                    <th style={{ padding: '6px 8px', borderRight: '1px solid #000', textAlign: 'center', width: '35px' }}>S No</th>
                    <th style={{ padding: '6px 8px', borderRight: '1px solid #000', textAlign: 'left' }}>Material Code & Description</th>
                    <th style={{ padding: '6px 8px', borderRight: '1px solid #000', textAlign: 'center', width: '85px' }}>Delivery Date</th>
                    <th style={{ padding: '6px 8px', borderRight: '1px solid #000', textAlign: 'center', width: '65px' }}>Qty (UoM)</th>
                    <th style={{ padding: '6px 8px', borderRight: '1px solid #000', textAlign: 'right', width: '85px' }}>Unit Rate (INR)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', width: '95px' }}>Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.line_items || []).map((item, index) => (
                    <tr key={item.id || index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px', borderRight: '1px solid #000', textAlign: 'center' }}>{index + 1}</td>
                      <td style={{ padding: '8px', borderRight: '1px solid #000', fontWeight: 600 }}>
                        {item.item?.name || 'Item'}
                        {item.description && <div style={{ fontWeight: 400, color: '#475569', marginTop: '2px' }}>{item.description}</div>}
                      </td>
                      <td style={{ padding: '8px', borderRight: '1px solid #000', textAlign: 'center' }}>
                        {po.delivery_date ? format(new Date(po.delivery_date), 'dd-MM-yyyy') : '-'}
                      </td>
                      <td style={{ padding: '8px', borderRight: '1px solid #000', textAlign: 'center' }}>{item.quantity}</td>
                      <td style={{ padding: '8px', borderRight: '1px solid #000', textAlign: 'right' }}>₹{Number(item.rate || 0).toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>₹{Number(item.item_total || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* PDF Totals & Signatures Grid */}
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000', fontSize: '11px' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '60%', padding: '12px', verticalAlign: 'top', borderRight: '1px solid #000' }}>
                      <div style={{ marginBottom: '12px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        <strong>Notes:</strong><br />
                        {po.notes || 'With reference to your above quotation, we request you to supply the following materials subject to terms and conditions.'}
                      </div>

                      {po.terms && (
                        <div style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                          <strong>Terms & Conditions:</strong><br />
                          {po.terms}
                        </div>
                      )}
                    </td>
                    <td style={{ width: '40%', padding: '12px', verticalAlign: 'top', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span>Sub Total:</span>
                        <strong>₹{Number(po.sub_total || 0).toFixed(2)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', paddingTop: '6px', fontSize: '12px', fontWeight: 700 }}>
                        <span>Total:</span>
                        <strong>₹{Number(po.total || 0).toFixed(2)}</strong>
                      </div>

                      <div style={{ marginTop: '40px', fontSize: '11px', color: '#333' }}>
                        <div>For, {currentOrg?.name || 'Company Name'}</div>
                        <div style={{ marginTop: '30px', fontWeight: 600 }}>Authorized Signature</div>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: activeTab === 'Comments' ? 'block' : 'none', padding: '16px' }}>
          <PurchaseOrderComments orgId={orgId!} poId={poId} />
        </div>
        <div style={{ display: activeTab === 'Activity' ? 'block' : 'none', padding: '16px' }}>
          <PurchaseOrderActivityTimeline orgId={orgId!} poId={poId} />
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        title="Delete Purchase Order"
        message={`Are you sure you want to delete Purchase Order ${po.purchaseorder_number}? This action cannot be undone.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />
    </div>
  );
}
