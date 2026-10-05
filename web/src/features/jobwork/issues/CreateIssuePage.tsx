import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, X, Clock, ChevronRight, Package, Layers, Info } from 'lucide-react';
import { fetchJobOrderOverview, fetchJobOrderWithStepsById } from '../job-orders/jobOrders.api';
import { Spinner } from '../../../components/ui/Spinner';
import { LocalComboBox } from '../../../components/ui/LocalComboBox';
import { JobOrderComboBox } from '../job-orders/JobOrderComboBox';
import { IssueForm } from './IssueForm';
import { fetchJobIssueById } from './jobIssues.api';
import { formatQty } from '../jobwork.schemas';

export function CreateIssuePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const jobOrderIdParam = searchParams.get('jobOrderId');
  const stepIdParam = searchParams.get('stepId');
  const draftId = searchParams.get('draftId');

  const { data: draft, isLoading: isLoadingDraft } = useQuery({
    queryKey: ['job-issue', orgId, draftId],
    queryFn: () => fetchJobIssueById(orgId!, draftId!),
    enabled: Boolean(orgId && draftId),
  });

  const [selectedJobOrderId, setSelectedJobOrderId] = useState<string | null>(jobOrderIdParam);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(stepIdParam);

  const effectiveJobOrderId = draft?.jobOrderId ?? selectedJobOrderId;
  const effectiveStepId = draft?.jobOrderStepId ?? selectedStepId;

  // 2a. Fetch lightweight Job Order to get Steps once a Job Order is selected
  const { data: lightweightJobOrder, isLoading: isLoadingLightweightJobOrder } = useQuery({
    queryKey: ['job-order-with-steps', orgId, effectiveJobOrderId],
    queryFn: () => fetchJobOrderWithStepsById(orgId!, effectiveJobOrderId!),
    enabled: Boolean(orgId && effectiveJobOrderId),
  });

  const stepOptions = useMemo(() => {
    if (!lightweightJobOrder?.steps) return [];
    return lightweightJobOrder.steps.map((s) => ({
      value: s.id,
      label: `Step ${s.seq}: ${s.processNameSnapshot} (${s.processorNameSnapshot ?? (s.processorType === 'internal' ? 'In-house' : 'Vendor')})`,
    }));
  }, [lightweightJobOrder]);

  // 2b. Fetch heavy Job Order Overview ONLY when a Step is selected
  const { data: jobOrderData, isLoading: isLoadingJobOrderOverview } = useQuery({
    queryKey: ['job-order-overview', orgId, effectiveJobOrderId, effectiveStepId],
    queryFn: () =>
      fetchJobOrderOverview(orgId!, effectiveJobOrderId!, effectiveStepId || undefined),
    enabled: Boolean(orgId && effectiveJobOrderId && effectiveStepId),
  });

  const selectedStep = useMemo(() => {
    return jobOrderData?.steps?.find((s) => s.id === effectiveStepId) || null;
  }, [jobOrderData, effectiveStepId]);

  const handleBack = () => {
    if (jobOrderIdParam) {
      navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderIdParam}`);
    } else if (draftId) {
      navigate(`/organizations/${orgId}/jobwork/issues?id=${draftId}&filter=draft`);
    } else {
      navigate(
        (location.state as { returnUrl?: string })?.returnUrl ||
          `/organizations/${orgId}/jobwork/issues`,
      );
    }
  };

  return (
    <div
      style={{
        background: '#f8fafc',
        minHeight: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Navigation & Breadcrumb Header */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '14px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: '#fff',
              cursor: 'pointer',
              color: '#475569',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.color = '#1e293b';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.color = '#475569';
            }}
          >
            <ArrowLeft size={16} />
          </button>

          <div>
            {/* Breadcrumb path */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#64748b',
                marginBottom: 2,
              }}
            >
              <span>Jobwork</span>
              <ChevronRight size={12} />
              <span onClick={handleBack} style={{ cursor: 'pointer', textDecoration: 'underline' }}>
                Challans
              </span>
              <ChevronRight size={12} />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>
                {draft ? `Draft ${draft.challanNumber}` : 'New Material Issue'}
              </span>
            </div>

            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              {draft ? `Edit Draft ${draft.challanNumber}` : 'Issue Material for Process Step'}
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={handleBack}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 6,
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#334155')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
        >
          <X size={20} />
        </button>
      </header>

      {/* Main Container */}
      <div
        style={{
          padding: '24px 28px',
          width: '100%',
          maxWidth: '1200px',
          margin: '0 auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Draft Notice Banner (Locked Job Order & Step context) */}
        {draft && (
          <div
            style={{
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: 8,
              padding: '14px 18px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: '#e0f2fe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#0284c7',
                }}
              >
                <Clock size={18} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#0369a1' }}>
                    Editing Saved Draft {draft.challanNumber}
                  </span>
                  <span
                    style={{
                      background: '#e0f2fe',
                      color: '#0284c7',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                    }}
                  >
                    Draft
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: '#0369a1', marginTop: 2 }}>
                  Linked to Job Order <strong>{draft.jobOrder?.jobOrderNumber}</strong> · Step{' '}
                  {draft.step?.seq}: {draft.step?.processNameSnapshot}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#0284c7', maxWidth: 360 }}>
              The Job Order and Step are locked on this draft to preserve previously allocated
              lines.
            </div>
          </div>
        )}

        {/* New Issue: Job Order & Process Step Selector Card */}
        {!draft && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              padding: '20px 24px',
              marginBottom: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#eff6ff',
                  color: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                1
              </div>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', margin: 0 }}>
                Select Job Order & Target Process Step
              </h2>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20,
                alignItems: 'start',
              }}
            >
              {/* Job Order Picker */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Job Order <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <JobOrderComboBox
                  orgId={orgId!}
                  value={effectiveJobOrderId || ''}
                  onChange={(id) => {
                    setSelectedJobOrderId(id);
                    setSelectedStepId(null);
                  }}
                  initialJobOrder={jobOrderData?.jobOrder}
                  placeholder="Select Job Order..."
                />
                <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                  Choose the active Job Order containing material to be processed
                </span>
              </div>

              {/* Step Picker */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Process Step <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <LocalComboBox
                  value={effectiveStepId || null}
                  onChange={(val) => setSelectedStepId(val || null)}
                  options={stepOptions}
                  placeholder={
                    !effectiveJobOrderId
                      ? 'Select a Job Order first'
                      : isLoadingLightweightJobOrder
                        ? 'Loading steps…'
                        : stepOptions.length === 0
                          ? 'No steps configured'
                          : 'Select Process Step...'
                  }
                  disabled={!effectiveJobOrderId || isLoadingLightweightJobOrder}
                  portal={false}
                />
                <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                  Material will be dispatched to this step’s processor
                </span>
              </div>
            </div>

            {/* Selected Job Order Quick Overview Card */}
            {lightweightJobOrder && (
              <div
                style={{
                  marginTop: 18,
                  padding: '12px 16px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Package size={18} color="#0284c7" />
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
                      {lightweightJobOrder.jobOrderNumber}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>
                      {lightweightJobOrder.inputItem?.name} (
                      {formatQty(lightweightJobOrder.inputQty)}{' '}
                      {lightweightJobOrder.inputUom?.symbol ??
                        lightweightJobOrder.inputUom?.unitName ??
                        ''}
                      )
                    </span>
                  </div>
                </div>

                {/* Available steps pills */}
                {lightweightJobOrder.steps && lightweightJobOrder.steps.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11.5, color: '#64748b', marginRight: 4 }}>Steps:</span>
                    {lightweightJobOrder.steps.map((st) => {
                      const isPicked = effectiveStepId === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSelectedStepId(st.id)}
                          style={{
                            padding: '3px 8px',
                            fontSize: 11.5,
                            fontWeight: isPicked ? 600 : 500,
                            borderRadius: 4,
                            cursor: 'pointer',
                            border: `1px solid ${isPicked ? '#0284c7' : '#e2e8f0'}`,
                            background: isPicked ? '#eff6ff' : '#fff',
                            color: isPicked ? '#0284c7' : '#475569',
                            transition: 'all 0.12s',
                          }}
                        >
                          Step {st.seq}: {st.processNameSnapshot}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading Indicators */}
        {isLoadingDraft && (
          <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
            <Spinner size={24} label="Loading draft details…" />
          </div>
        )}
        {isLoadingLightweightJobOrder && effectiveJobOrderId && (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
            <Spinner size={24} label="Loading job order details..." />
          </div>
        )}
        {!isLoadingLightweightJobOrder && isLoadingJobOrderOverview && effectiveStepId && (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
            <Spinner size={24} label="Loading step material configuration..." />
          </div>
        )}

        {/* Helpful Guidance State when Job Order or Step has not been selected yet */}
        {!draft && (!effectiveJobOrderId || !effectiveStepId) && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px dashed #cbd5e1',
              padding: '48px 32px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: '#f0f9ff',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Layers size={28} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 6px 0' }}>
              {!effectiveJobOrderId ? 'Select a Job Order to Begin' : 'Select the Process Step'}
            </h3>
            <p
              style={{
                fontSize: 13,
                color: '#64748b',
                maxWidth: 480,
                lineHeight: 1.5,
                margin: '0 0 16px 0',
              }}
            >
              {!effectiveJobOrderId
                ? 'Material issue challans dispatch inventory items from your godowns to in-house work centres or external jobworkers for a designated Job Order.'
                : 'Choose which process step of this Job Order you are issuing materials for. The form will load planned input items, stock availability, and batch selections.'}
            </p>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#0284c7',
                background: '#f0f9ff',
                padding: '6px 12px',
                borderRadius: 20,
              }}
            >
              <Info size={14} />
              <span>Goods cannot legally travel without an official delivery challan</span>
            </div>
          </div>
        )}

        {/* Issue Form Mounting */}
        {jobOrderData && selectedStep && (!draftId || draft) && (
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              padding: '24px 28px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <IssueForm
              key={draft?.id ?? 'new'}
              draft={draft ?? null}
              jobOrder={jobOrderData.jobOrder}
              step={selectedStep}
              onIssued={(issueId, isDraft) => {
                if (isDraft && issueId) {
                  navigate(`/organizations/${orgId}/jobwork/issues?id=${issueId}&filter=draft`);
                } else if (jobOrderIdParam) {
                  navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderIdParam}`);
                } else {
                  navigate(
                    (location.state as { returnUrl?: string })?.returnUrl ||
                      `/organizations/${orgId}/jobwork/issues`,
                  );
                }
              }}
              onCancel={handleBack}
            />
          </div>
        )}
      </div>
    </div>
  );
}
