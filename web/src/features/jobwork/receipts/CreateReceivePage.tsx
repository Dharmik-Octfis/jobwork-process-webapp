import { useState, useMemo } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery} from '@tanstack/react-query';
import { X } from 'lucide-react';
import { fetchJobOrderOverview, fetchJobOrderWithStepsById } from '../job-orders/jobOrders.api';
import { Spinner } from '../../../components/ui/Spinner';
import { LocalComboBox } from '../../../components/ui/LocalComboBox';
import { JobOrderComboBox } from '../job-orders/JobOrderComboBox';
import { ReceiveForm } from './ReceiveForm';

export function CreateReceivePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const jobOrderIdParam = searchParams.get('jobOrderId');
  const stepIdParam = searchParams.get('stepId');

  // If user hasn't selected a job order in the UI but it's not in URL, we need local state
  const [selectedJobOrderId, setSelectedJobOrderId] = useState<string | null>(jobOrderIdParam);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(stepIdParam);

  const effectiveJobOrderId = selectedJobOrderId;
  const effectiveStepId = selectedStepId;

  // 2a. Fetch lightweight Job Order to get Steps once a Job Order is selected
  const { data: lightweightJobOrder, isLoading: isLoadingLightweightJobOrder } = useQuery({
    queryKey: ['job-order-with-steps', orgId, effectiveJobOrderId],
    queryFn: () => fetchJobOrderWithStepsById(orgId!, effectiveJobOrderId!),
    enabled: Boolean(orgId && effectiveJobOrderId),
  });

  const stepOptions = useMemo(() => {
    if (!lightweightJobOrder?.steps) return [];
    // Show all steps
    return lightweightJobOrder.steps.map((s) => ({
      value: s.id,
      label: `Step ${s.seq}: ${s.processNameSnapshot} (${s.processorNameSnapshot ?? 'Internal'})`,
    }));
  }, [lightweightJobOrder]);

  // 2b. Fetch heavy Job Order Overview ONLY when a Step is selected
  const { data: jobOrderData, isLoading: isLoadingJobOrderOverview } = useQuery({
    queryKey: ['job-order-overview', orgId, effectiveJobOrderId, effectiveStepId],
    queryFn: () => fetchJobOrderOverview(orgId!, effectiveJobOrderId!, effectiveStepId || undefined),
    enabled: Boolean(orgId && effectiveJobOrderId && effectiveStepId),
  });

  const selectedStep = useMemo(() => {
    return jobOrderData?.steps?.find((s) => s.id === effectiveStepId) || null;
  }, [jobOrderData, effectiveStepId]);

  return (
    <div style={{ background: '#fff', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #eef0f3', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#111', margin: 0 }}>Receive Goods</h1>
        <button
          type="button"
          onClick={() => {
             if (jobOrderIdParam) {
               navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderIdParam}`);
             } else {
               navigate(`/organizations/${orgId}/jobwork/receipts`);
             }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px',
            borderRadius: '4px',
          }}
        >
          <X size={20} />
        </button>
      </header>

      <div style={{ padding: 24, width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: '#111', margin: '0 0 16px 0' }}>Select Context</h2>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ width: 320, minWidth: 250 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Job Order</label>
                <JobOrderComboBox
                  orgId={orgId!}
                  value={effectiveJobOrderId || ''}
                  onChange={(val) => {
                    setSelectedJobOrderId(val);
                    setSelectedStepId(null);
                  }}
                  initialJobOrder={jobOrderData?.jobOrder}
                  placeholder="Select Job Order..."
                />
              </div>
              <div style={{ width: 320, minWidth: 250 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 6 }}>Step</label>
                <LocalComboBox
                  value={effectiveStepId || null}
                  onChange={(val) => setSelectedStepId(val || null)}
                  options={stepOptions}
                  placeholder="Select Step..."
                  disabled={!effectiveJobOrderId || isLoadingLightweightJobOrder}
                  portal={false}
                />
              </div>
            </div>
          </div>

        {isLoadingLightweightJobOrder && effectiveJobOrderId && <Spinner size={24} label="Loading job order details..." />}
        {!isLoadingLightweightJobOrder && isLoadingJobOrderOverview && effectiveStepId && <Spinner size={24} label="Loading step details..." />}

        {jobOrderData && selectedStep && (
          <ReceiveForm
            jobOrder={jobOrderData.jobOrder}
            step={selectedStep}
            onReceived={() => {
              if (jobOrderIdParam) {
                navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderIdParam}`);
              } else {
                navigate(`/organizations/${orgId}/jobwork/receipts`);
              }
            }}
            onCancel={() => {
              if (jobOrderIdParam) {
                navigate(`/organizations/${orgId}/jobwork/job-orders/${jobOrderIdParam}`);
              } else {
                navigate(`/organizations/${orgId}/jobwork/receipts`);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
