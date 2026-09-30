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
import {
  fetchPurchaseOrderById,
  getPOSignedUrl,
  deletePurchaseOrder,
  type POAttachment,
} from './purchase-orders.api';
import { fetchPaymentTerms } from './payment-terms.api';
import { deleteBill } from '../bills/bills.api';
import { organizationsApi } from '../../organizations/organizations.api';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  X,
  Edit,
  ChevronDown,
  FileText,
  Paperclip,
  Trash2,
  Printer,
  Mail,
  Share2,
  MessageSquare,
  Sparkles,
  Check,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { PurchaseOrderComments } from './PurchaseOrderComments';
import { PurchaseOrderActivityTimeline } from './PurchaseOrderActivityTimeline';
import { PurchaseOrderStatusBadge } from './PurchaseOrderStatusBadge';

function POAttachmentLink({ orgId, attachment }: { orgId: string; attachment: POAttachment }) {
  const isDirectUrl = Boolean(attachment.data || attachment.url);
  const { data: signedUrl } = useQuery({
    queryKey: ['poAttachmentSignedUrl', orgId, attachment.key],
    queryFn: () => getPOSignedUrl(orgId, attachment.key!),
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
        style={{ color: '#0284c7', textDecoration: 'none', fontWeight: 500 }}
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
  const location = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('Overview');
  const [activeSubTab, setActiveSubTab] = useState<'Bills' | 'Receives'>('Bills');
  const [isPdfView, setIsPdfView] = useState(false);
  const [isPdfMenuOpen, setIsPdfMenuOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const pdfMenuRef = useRef<HTMLDivElement>(null);
  const pdfTemplateRef = useRef<HTMLDivElement>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Link copied to clipboard!');
  };

  const handleSendEmail = () => {
    const email = po?.vendor?.email || '';
    const subject = encodeURIComponent(`Purchase Order ${po?.poNumber || ''}`);
    const body = encodeURIComponent(
      `Hi ${po?.vendor?.contactName || ''},\n\nPlease find attached Purchase Order ${po?.poNumber || ''}.\n\nThank you.`,
    );
    window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_blank');
  };

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
            filename: `${po?.poNumber || 'PO'}.pdf`,
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

  const [billToDelete, setBillToDelete] = useState<string | null>(null);

  const deleteBillMutation = useMutation({
    mutationFn: (billId: string) => deleteBill(orgId!, billId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchaseOrder', orgId, poId] });
      setBillToDelete(null);
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
    const found = paymentTerms?.find(
      (pt) => pt.id.toString() === termVal || pt.termName === termVal,
    );
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

  const poMeta = po as unknown as Record<string, unknown>;
  const rawLocation = poMeta.location as { name?: string } | undefined;
  const rawComments = Array.isArray(poMeta.comments) ? poMeta.comments : [];
  const createdByUser = poMeta.createdByUser as { name?: string; email?: string } | undefined;
  const updatedByUser = poMeta.updatedByUser as { name?: string; email?: string } | undefined;

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
      {/* Zoho Books Style Header */}
      <div
        style={{
          padding: '16px 24px 12px 24px',
          borderBottom: '1px solid #eef0f3',
          background: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Row 1: Location & Header Icons (Attach, Comments, Close) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500, marginBottom: 2 }}>
              Location: {po.deliveryLocation?.name || rawLocation?.name || 'Head Office'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  color: '#0f172a',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                {po.poNumber}
              </h1>
              <PurchaseOrderStatusBadge status={po.status} size="sm" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Upload files / Attachments button */}
            <button
              onClick={() => {
                setActiveTab('Overview');
                const el = document.getElementById('po-attachments-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              title="Upload files"
              aria-label="Upload files"
              style={{
                position: 'relative',
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#64748b',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9';
                e.currentTarget.style.color = '#1e293b';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#64748b';
              }}
            >
              <Paperclip size={18} />
              {po.documents && Array.isArray(po.documents) && po.documents.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: '#0284c7',
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: 700,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {po.documents.length}
                </span>
              )}
            </button>

            {/* Comments button */}
            <button
              onClick={() => setActiveTab('Comments')}
              title="Comments"
              aria-label="Comments"
              style={{
                position: 'relative',
                padding: '6px 8px',
                border: 'none',
                background: activeTab === 'Comments' ? '#f0f7fd' : 'transparent',
                cursor: 'pointer',
                color: activeTab === 'Comments' ? '#0284c7' : '#64748b',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (activeTab !== 'Comments') {
                  e.currentTarget.style.background = '#f1f5f9';
                  e.currentTarget.style.color = '#1e293b';
                }
              }}
              onMouseLeave={(e) => {
                if (activeTab !== 'Comments') {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#64748b';
                }
              }}
            >
              <MessageSquare size={18} />
              {rawComments.length > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    background: '#0284c7',
                    color: 'white',
                    fontSize: '10px',
                    fontWeight: 700,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {rawComments.length}
                </span>
              )}
            </button>

            {/* Close button */}
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              style={{
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                color: '#ef4444',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#fef2f2';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <X size={19} />
            </button>
          </div>
        </div>

        {/* Row 2: Action Toolbar (Edit, Send Email, Share, PDF/Print, Convert to Bill, More) */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}
        >
          <button
            onClick={() =>
              navigate(`/organizations/${orgId}/purchases/purchase-orders/${poId}/edit`, {
                state: { returnUrl: location.pathname + location.search },
              })
            }
            style={{
              padding: '6px 12px',
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#334155',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f7fd';
              e.currentTarget.style.color = '#0284c7';
              e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
              e.currentTarget.style.color = '#334155';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <Edit size={14} /> Edit
          </button>

          <button
            onClick={handleSendEmail}
            style={{
              padding: '6px 12px',
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#334155',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f7fd';
              e.currentTarget.style.color = '#0284c7';
              e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
              e.currentTarget.style.color = '#334155';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <Mail size={14} /> Send Email
          </button>

          <button
            onClick={handleShare}
            style={{
              padding: '6px 12px',
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#334155',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f7fd';
              e.currentTarget.style.color = '#0284c7';
              e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#fff';
              e.currentTarget.style.color = '#334155';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <Share2 size={14} /> Share
          </button>

          {/* PDF / Print */}
          <div style={{ position: 'relative' }} ref={pdfMenuRef}>
            <button
              onClick={() => setIsPdfMenuOpen(!isPdfMenuOpen)}
              style={{
                padding: '6px 12px',
                border: isPdfMenuOpen ? '1px solid #0284c7' : '1px solid #e2e8f0',
                background: isPdfMenuOpen ? '#f0f7fd' : '#fff',
                color: isPdfMenuOpen ? '#0284c7' : '#334155',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isPdfMenuOpen) {
                  e.currentTarget.style.backgroundColor = '#f0f7fd';
                  e.currentTarget.style.color = '#0284c7';
                  e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isPdfMenuOpen) {
                  e.currentTarget.style.backgroundColor = '#fff';
                  e.currentTarget.style.color = '#334155';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }
              }}
            >
              <FileText size={14} /> PDF/Print{' '}
              <ChevronDown
                size={13}
                style={{
                  transform: isPdfMenuOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </button>

            {isPdfMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  left: 0,
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  boxShadow: '0 10px 20px rgba(0, 0, 0, 0.08)',
                  width: '150px',
                  zIndex: 30,
                  padding: '4px',
                }}
              >
                <div
                  onClick={handleDownloadPdf}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.color = '#0284c7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#1e293b';
                  }}
                >
                  <FileText size={14} /> Download PDF
                </div>
                <div
                  onClick={handlePrint}
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.color = '#0284c7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#1e293b';
                  }}
                >
                  <Printer size={14} /> Print
                </div>
              </div>
            )}
          </div>

          {/* Convert to Bill button in header */}
          {(!po.bills || po.bills.length === 0) && po.status !== 'Cancelled' && (
            <button
              onClick={() => navigate(`/organizations/${orgId}/purchases/bills/new?fromPo=${poId}`)}
              style={{
                padding: '6px 12px',
                border: '1px solid #e2e8f0',
                background: '#fff',
                color: '#334155',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f0f7fd';
                e.currentTarget.style.color = '#0284c7';
                e.currentTarget.style.borderColor = 'rgba(2, 132, 199, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
                e.currentTarget.style.color = '#334155';
                e.currentTarget.style.borderColor = '#e2e8f0';
              }}
            >
              <FileText size={14} /> Convert to Bill
            </button>
          )}
        </div>

        {/* Row 3: Subtitle Metadata (Submitted by, Approved by, View Approval History) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: '12px',
            color: '#64748b',
            paddingTop: 4,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Submitted by:</span>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#e0f2fe',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              {(createdByUser?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <span style={{ fontWeight: 500, color: '#1e293b' }}>
              {createdByUser?.name || createdByUser?.email || 'User'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Approved by:</span>
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#dcfce7',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              {(updatedByUser?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <span style={{ fontWeight: 500, color: '#1e293b' }}>
              {updatedByUser?.name || updatedByUser?.email || 'Approver'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs Row */}
      <div
        className="detail-page-tabs"
        style={{ background: '#fff', borderBottom: '1px solid #eef0f3' }}
      >
        {tabs.map((tab) => (
          <div
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`detail-tab ${activeTab === tab ? 'active' : ''}`}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: activeTab === tab ? 600 : 500,
              color: activeTab === tab ? '#0284c7' : '#64748b',
              borderBottom: activeTab === tab ? '2px solid #0284c7' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: '#0f172a',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Check size={16} color="#38bdf8" />
          {toastMessage}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 0, background: '#f8fafc' }}>
        <div
          style={{
            display: activeTab === 'Overview' ? 'flex' : 'none',
            flexDirection: 'column',
            padding: '16px 24px',
          }}
        >
          {/* WHAT'S NEXT? Banner */}
          {(!po.bills || po.bills.length === 0) && po.status !== 'Cancelled' && (
            <div
              style={{
                background: '#f8faff',
                border: '1px solid #e0e7ff',
                borderRadius: '8px',
                padding: '12px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '13px',
                  color: '#1e293b',
                }}
              >
                <Sparkles size={16} color="#8b5cf6" />
                <span
                  style={{
                    fontWeight: 700,
                    color: '#4f46e5',
                    letterSpacing: '0.02em',
                    fontSize: '11.5px',
                  }}
                >
                  WHAT&apos;S NEXT?
                </span>
                <span>Convert this to a bill to complete your purchase.</span>
              </div>
              <button
                onClick={() =>
                  navigate(`/organizations/${orgId}/purchases/bills/new?fromPo=${poId}`)
                }
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '7px 16px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 10px rgba(2, 132, 199, 0.35)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(2, 132, 199, 0.25)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                Convert to Bill
              </button>
            </div>
          )}

          {/* Bills / Receives Sub-Bar */}
          <div
            style={{
              padding: '0 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', gap: '20px' }}>
              <button
                type="button"
                onClick={() => setActiveSubTab('Bills')}
                style={{
                  padding: '10px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom:
                    activeSubTab === 'Bills' ? '2px solid #0284c7' : '2px solid transparent',
                  color: activeSubTab === 'Bills' ? '#0284c7' : '#64748b',
                  fontWeight: activeSubTab === 'Bills' ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.12s ease',
                }}
              >
                Bills{' '}
                <span
                  style={{
                    background: activeSubTab === 'Bills' ? '#f0f7fd' : '#f1f5f9',
                    color: activeSubTab === 'Bills' ? '#0284c7' : '#64748b',
                    border:
                      activeSubTab === 'Bills'
                        ? '1px solid rgba(2, 132, 199, 0.25)'
                        : '1px solid #e2e8f0',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {po.bills?.length || 0}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('Receives')}
                style={{
                  padding: '10px 0',
                  background: 'none',
                  border: 'none',
                  borderBottom:
                    activeSubTab === 'Receives' ? '2px solid #0284c7' : '2px solid transparent',
                  color: activeSubTab === 'Receives' ? '#0284c7' : '#64748b',
                  fontWeight: activeSubTab === 'Receives' ? 600 : 500,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.12s ease',
                }}
              >
                Receives{' '}
                <span
                  style={{
                    background: activeSubTab === 'Receives' ? '#f0f7fd' : '#f1f5f9',
                    color: activeSubTab === 'Receives' ? '#0284c7' : '#64748b',
                    border:
                      activeSubTab === 'Receives'
                        ? '1px solid rgba(2, 132, 199, 0.25)'
                        : '1px solid #e2e8f0',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  0
                </span>
              </button>
            </div>
          </div>

          {/* Executive Lifecycle Workflow Tracker */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '14px 20px',
              margin: '14px 0 16px 0',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              {/* Stepper Pipeline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Step 1: Draft */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#10b981',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </div>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>Draft</span>
                </div>

                <div style={{ width: 24, height: 2, background: '#10b981', borderRadius: 1 }} />

                {/* Step 2: Issued */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: po.status !== 'Draft' ? '#10b981' : '#e0f2fe',
                      color: po.status !== 'Draft' ? 'white' : '#0284c7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {po.status !== 'Draft' ? '✓' : '2'}
                  </div>
                  <span
                    style={{
                      fontWeight: 600,
                      color: po.status !== 'Draft' ? '#0f172a' : '#64748b',
                    }}
                  >
                    Issued
                  </span>
                </div>

                <div
                  style={{
                    width: 24,
                    height: 2,
                    background: po.bills?.length ? '#10b981' : '#e2e8f0',
                    borderRadius: 1,
                  }}
                />

                {/* Step 3: Billed */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: po.bills?.length ? '#10b981' : '#f1f5f9',
                      color: po.bills?.length ? 'white' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {po.bills?.length ? '✓' : '3'}
                  </div>
                  <span
                    style={{
                      fontWeight: 600,
                      color: po.bills?.length ? '#059669' : '#64748b',
                    }}
                  >
                    {po.bills?.length ? 'Billed' : 'Yet to be Billed'}
                  </span>
                </div>

                <div
                  style={{
                    width: 24,
                    height: 2,
                    background: po.status === 'Closed' ? '#10b981' : '#e2e8f0',
                    borderRadius: 1,
                  }}
                />

                {/* Step 4: Received */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: po.status === 'Closed' ? '#10b981' : '#f1f5f9',
                      color: po.status === 'Closed' ? 'white' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {po.status === 'Closed' ? '✓' : '4'}
                  </div>
                  <span
                    style={{
                      fontWeight: 600,
                      color: po.status === 'Closed' ? '#059669' : '#64748b',
                    }}
                  >
                    {po.status === 'Closed' ? 'Received' : 'Yet to be Received'}
                  </span>
                </div>
              </div>

              {/* PDF View Toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '12.5px', color: '#64748b', fontWeight: 500 }}>
                  Show PDF Print View
                </span>
                <label
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                    width: '36px',
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
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: isPdfView ? '#0284c7' : '#cbd5e1',
                      transition: '0.2s',
                      borderRadius: '20px',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      height: '14px',
                      width: '14px',
                      left: isPdfView ? '19px' : '3px',
                      bottom: '3px',
                      backgroundColor: 'white',
                      transition: '0.2s',
                      borderRadius: '50%',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Bills List View */}
          {!isPdfView && activeSubTab === 'Bills' && po.bills && po.bills.length > 0 && (
            <div
              style={{
                marginBottom: '24px',
                overflow: 'hidden',
              }}
            >
              <div className="responsive-table-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#64748b',
                        }}
                      >
                        Bill#
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#64748b',
                        }}
                      >
                        Date
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#64748b',
                        }}
                      >
                        Status
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#64748b',
                        }}
                      >
                        Due Date
                      </th>
                      <th
                        style={{
                          padding: '12px 16px',
                          textAlign: 'right',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#64748b',
                        }}
                      >
                        Amount
                      </th>
                      <th style={{ padding: '12px 16px', width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.bills.map((bill: import('../bills/bills.schemas').Bill) => (
                      <tr
                        key={bill.id}
                        style={{ borderBottom: '1px solid #f1f5f9' }}
                        onMouseEnter={(e) => {
                          const icon = e.currentTarget.querySelector(
                            '.delete-bill-icon',
                          ) as HTMLElement;
                          if (icon) icon.style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          const icon = e.currentTarget.querySelector(
                            '.delete-bill-icon',
                          ) as HTMLElement;
                          if (icon) icon.style.opacity = '0';
                        }}
                      >
                        <td style={{ padding: '14px 16px', fontSize: '13px' }}>
                          <span
                            onClick={() =>
                              navigate(`/organizations/${orgId}/purchases/bills/${bill.id}`)
                            }
                            style={{ color: '#0284c7', cursor: 'pointer', fontWeight: 600 }}
                          >
                            {bill.billNumber}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#1e293b' }}>
                          {bill.billDate ? format(new Date(bill.billDate), 'dd-MM-yyyy') : '-'}
                        </td>
                        <td
                          style={{
                            padding: '14px 16px',
                            fontSize: '13px',
                            color: '#64748b',
                            textTransform: 'uppercase',
                          }}
                        >
                          {bill.status}
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: '13px', color: '#1e293b' }}>
                          {bill.dueDate ? format(new Date(bill.dueDate), 'dd-MM-yyyy') : '-'}
                        </td>
                        <td
                          style={{
                            padding: '14px 16px',
                            fontSize: '13px',
                            color: '#0f172a',
                            fontWeight: 500,
                            textAlign: 'right',
                          }}
                        >
                          ₹{Number(bill.totalAmount || 0).toFixed(2)}
                        </td>
                        <td style={{ width: '40px', padding: '14px 16px', textAlign: 'right' }}>
                          <div
                            className="delete-bill-icon"
                            style={{
                              display: 'inline-flex',
                              cursor: 'pointer',
                              color: '#ef4444',
                              opacity: 0,
                              transition: 'opacity 0.2s',
                            }}
                            onClick={() => setBillToDelete(bill.id)}
                            title="Delete Bill"
                          >
                            <Trash2 size={16} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VIEW MODE 1: Standard Web View (isPdfView === false) */}
          {!isPdfView && (
            <div
              style={{
                position: 'relative',
                overflow: 'hidden',
                background: '#fff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '32px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}
            >
              {/* Top-Left Diagonal Status Ribbon */}
              {(() => {
                const ribbonColor =
                  po.status === 'ISSUED' || po.status === 'SENT'
                    ? '#0284c7'
                    : po.status === 'APPROVED'
                      ? '#059669'
                      : po.status === 'CLOSED'
                        ? '#059669'
                        : po.status === 'CANCELLED'
                          ? '#ef4444'
                          : '#64748b'; // Draft or default
                return (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '120px',
                      height: '120px',
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: '20px',
                        left: '-35px',
                        width: '135px',
                        transform: 'rotate(-45deg)',
                        backgroundColor: ribbonColor,
                        color: '#ffffff',
                        textAlign: 'center',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        padding: '4px 0',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                      }}
                    >
                      {po.status || 'DRAFT'}
                    </div>
                  </div>
                );
              })()}

              {/* Organization & Purchase Order Top Bar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '24px',
                  paddingLeft: '48px', // Space for diagonal ribbon
                  gap: '24px',
                }}
              >
                {/* Organization Details */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    maxWidth: '360px',
                  }}
                >
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 700,
                      fontSize: '18px',
                      flexShrink: 0,
                      boxShadow: '0 2px 6px rgba(2,132,199,0.25)',
                    }}
                  >
                    {currentOrg?.name?.charAt(0)?.toUpperCase() || 'O'}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        color: '#0f172a',
                        lineHeight: 1.2,
                      }}
                    >
                      {currentOrg?.name || 'Company Name'}
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#64748b',
                        marginTop: '4px',
                        lineHeight: 1.4,
                      }}
                    >
                      {currentOrg?.address?.streetAddress1 && (
                        <div>{currentOrg.address.streetAddress1}</div>
                      )}
                      <div>
                        {[
                          currentOrg?.address?.city,
                          currentOrg?.address?.stateCode,
                          currentOrg?.address?.zip,
                        ]
                          .filter(Boolean)
                          .join(', ') || 'Surat, Gujarat 395600'}
                      </div>
                      <div>{currentOrg?.address?.country || 'India'}</div>
                    </div>
                  </div>
                </div>

                {/* Purchase Order Title & Details */}
                <div style={{ textAlign: 'right', minWidth: '220px' }}>
                  <h1
                    style={{
                      fontSize: '24px',
                      fontWeight: 800,
                      color: '#0f172a',
                      letterSpacing: '0.02em',
                      margin: '0 0 6px 0',
                    }}
                  >
                    PURCHASE ORDER
                  </h1>
                  <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '8px' }}>
                    Purchase Order# <strong style={{ color: '#0f172a' }}>{po.poNumber}</strong>
                  </div>

                  <div
                    style={{
                      display: 'inline-flex',
                      flexDirection: 'column',
                      gap: '4px',
                      textAlign: 'right',
                      fontSize: '12px',
                      color: '#475569',
                    }}
                  >
                    <div>
                      <span style={{ color: '#64748b' }}>Order Date: </span>
                      <strong style={{ color: '#0f172a' }}>
                        {po.date ? format(new Date(po.date), 'dd-MM-yyyy') : '-'}
                      </strong>
                    </div>
                    {po.deliveryDate && (
                      <div>
                        <span style={{ color: '#64748b' }}>Expected Delivery: </span>
                        <strong style={{ color: '#0f172a' }}>
                          {format(new Date(po.deliveryDate), 'dd-MM-yyyy')}
                        </strong>
                      </div>
                    )}
                    {po.referenceNumber && (
                      <div>
                        <span style={{ color: '#64748b' }}>Ref#: </span>
                        <strong style={{ color: '#0f172a' }}>{po.referenceNumber}</strong>
                      </div>
                    )}
                    {po.paymentTerms && (
                      <div>
                        <span style={{ color: '#64748b' }}>Payment Terms: </span>
                        <strong style={{ color: '#0f172a' }}>
                          {getPaymentTermLabel(po.paymentTerms)}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Vendor & Delivery Addresses Row */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '48px',
                  marginBottom: '28px',
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: '16px',
                }}
              >
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
                      color: '#0284c7',
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
                    {po.deliveryType === 'Location'
                      ? po.deliveryLocation?.name || 'Head Office'
                      : po.deliveryCustomer?.contactName || '-'}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#475569',
                      lineHeight: 1.5,
                      maxWidth: '220px',
                    }}
                  >
                    {po.deliveryType === 'Location' && po.deliveryLocation?.address}
                  </div>
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
                        ORDERED
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
                          : item.discountPercentage || item.discount || 0,
                      );
                      const discDisplay =
                        item.discountType === 'fixed' ? `₹${discVal.toFixed(2)}` : `${discVal}%`;

                      return (
                        <tr
                          key={item.id || item.lineItemId || index}
                          style={{ borderBottom: '1px solid #f1f5f9' }}
                        >
                          <td
                            style={{
                              padding: '14px 12px',
                              fontSize: '13px',
                              color: '#0284c7',
                              fontWeight: 600,
                              verticalAlign: 'top',
                            }}
                          >
                            {item.item?.name || 'Item'}
                            {item.description && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: '#64748b',
                                  marginTop: '2px',
                                  fontWeight: 400,
                                }}
                              >
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
                            {po.deliveryLocation?.name || 'Head Office'}
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
                            ₹{Number(item.itemTotal || 0).toFixed(2)}
                          </td>
                        </tr>
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
                  {po.notes && (
                    <div style={{ marginBottom: '16px' }}>
                      <strong
                        style={{ color: '#1e293b', fontSize: '12px', textTransform: 'uppercase' }}
                      >
                        Notes:
                      </strong>
                      <div style={{ marginTop: '4px', lineHeight: 1.5, color: '#475569' }}>
                        {po.notes}
                      </div>
                    </div>
                  )}

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

                  {po.documents && Array.isArray(po.documents) && po.documents.length > 0 && (
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
                        {po.documents.map((att: POAttachment, index: number) => (
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
                            <FileText size={14} color="#0284c7" />
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
                  {Number(po.subTotal || 0) > Number(po.totalAmount || 0) && (
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
                        -₹{(Number(po.subTotal) - Number(po.totalAmount)).toFixed(2)}
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
                    <span>₹{Number(po.totalAmount || 0).toFixed(2)}</span>
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
                        <h2
                          className="detail-title"
                          style={{
                            fontSize: '26px',
                            fontWeight: 800,
                            color: '#000',
                            margin: 0,
                            letterSpacing: '1px',
                          }}
                        >
                          PURCHASE ORDER
                        </h2>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* PDF PO Meta Table */}
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
                        <strong>PO No.</strong> : <strong>{po.poNumber}</strong>
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
                        {po.date ? format(new Date(po.date), 'dd-MM-yyyy') : '-'}
                      </td>
                      <td style={{ width: '50%', padding: '6px 10px' }}>
                        <strong>Terms</strong> : {getPaymentTermLabel(po.paymentTerms)}
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
                        <strong>
                          {po.deliveryType === 'Location'
                            ? po.deliveryLocation?.name || 'Head Office'
                            : po.deliveryCustomer?.contactName || '-'}
                        </strong>
                        {po.deliveryType === 'Location' && (
                          <div>{po.deliveryLocation?.address}</div>
                        )}
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
                      <th style={{ padding: '6px 8px', textAlign: 'right', width: '95px' }}>
                        Total Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(po.lineItems || []).map((item, index) => (
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
                          {po.deliveryDate ? format(new Date(po.deliveryDate), 'dd-MM-yyyy') : '-'}
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
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                          ₹{Number(item.itemTotal || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
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
                        <div
                          style={{
                            marginBottom: '12px',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          <strong>Notes:</strong>
                          <br />
                          {po.notes ||
                            'With reference to your above quotation, we request you to supply the following materials subject to terms and conditions.'}
                        </div>

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
                          <strong>₹{Number(po.totalAmount || 0).toFixed(2)}</strong>
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
        message={`Are you sure you want to delete Purchase Order ${po.poNumber}? This action cannot be undone.`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />

      <ConfirmDialog
        isOpen={Boolean(billToDelete)}
        title="Delete Bill"
        message="Are you sure you want to delete this bill? This action cannot be undone."
        confirmText={deleteBillMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => billToDelete && deleteBillMutation.mutate(billToDelete)}
        onCancel={() => setBillToDelete(null)}
      />
    </div>
  );
}
