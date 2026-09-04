import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Spinner } from '../../../components/ui/Spinner';
import { formatDate } from '../../../lib/formatDate';
import { organizationsApi } from '../../organizations/organizations.api';
import { ISSUE_STATUS_META, formatQty, sharedUnit, statusMeta, toNumber } from '../jobwork.schemas';
import { cancelJobIssue, deleteJobIssue, fetchJobIssueById, postJobIssue } from './jobIssues.api';
import { printChallan } from './printChallan';
import type { JobIssue, JobIssuesPage } from './jobIssues.schemas';
import { useTrackingLabel, useBatchUnitLabel } from '../../../hooks/useTrackingLabel';

interface Props {
  issueId: string;
  onClose: () => void;
}

const rowLabel: React.CSSProperties = { fontSize: 12, color: '#64748b', paddingRight: 16 };
const rowValue: React.CSSProperties = { fontSize: 13, color: '#111', padding: '6px 0' };

const th: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 11,
  color: '#64748b',
  textTransform: 'uppercase',
  textAlign: 'left',
};

const td: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: '#333' };

export function IssueDetail({ issueId, onClose }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgId } = useParams<{ orgId: string }>();
  const trackingLabel = useTrackingLabel();
  /** What this org calls the level below a batch, for the challan's own column. */
  const unitLabel = useBatchUnitLabel();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['job-issue', orgId, issueId],
    queryFn: () => fetchJobIssueById(orgId!, issueId),
    enabled: Boolean(orgId && issueId),
  });

  // The letterhead on the printed challan. Cached across the app, so this is a
  // cache read almost always rather than a request per challan.
  const { data: organizations = [] } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });
  const orgName =
    organizations.find((org) => org.organizationId === orgId)?.name ?? 'Delivery Challan';

  const cancelMutation = useMutation({
    mutationFn: () => cancelJobIssue(orgId!, issueId, cancelReason),
    onSuccess: () => {
      queryClient.setQueriesData(
        { queryKey: ['job-issues', orgId], type: 'active' },
        (old: JobIssuesPage | undefined) => {
          if (!old || !old.results) return old;
          return {
            ...old,
            results: old.results.map((item: JobIssue) =>
              item.id === issueId ? { ...item, status: 'cancelled' } : item,
            ),
          };
        },
      );
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId], type: 'inactive' });
      queryClient.invalidateQueries({ queryKey: ['job-issue', orgId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      setCancelOpen(false);
      setCancelReason('');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not cancel this challan');
    },
  });

  /**
   * Issue a draft as it stands.
   *
   * 🔴 A 400 here is the NORMAL outcome, not a bug: the draft skipped the stock,
   * tolerance and step-chain checks, and this is where they run. The message says
   * which one refused it, so it is shown rather than replaced with a generic one.
   */
  const postMutation = useMutation({
    mutationFn: () => postJobIssue(orgId!, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-issue', orgId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      // The stock behind it has just moved, so anything valuing or listing it is stale.
      queryClient.invalidateQueries({ queryKey: ['available-batches', orgId] });
      queryClient.invalidateQueries({ queryKey: ['stock-locations', orgId] });
      setError(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not issue this challan');
    },
  });

  /** Only a draft reaches this — a posted challan is cancelled, which reverses
   * its ledger rows rather than removing anything. */
  const deleteMutation = useMutation({
    mutationFn: () => deleteJobIssue(orgId!, issueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-issues', orgId] });
      queryClient.invalidateQueries({ queryKey: ['job-order-overview', orgId] });
      setDeleteOpen(false);
      onClose();
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setError(err.response?.data?.message ?? 'Could not delete this draft');
      setDeleteOpen(false);
    },
  });

  if (isLoading) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner size={24} label="Loading challan" />
      </div>
    );
  }

  if (!issue) {
    return <div style={{ padding: 32, color: '#64748b', fontSize: 13 }}>Challan not found.</div>;
  }

  // Blank when the lines carry different units — the header total is then a
  // count of nothing in particular and must not borrow one of them.
  const unit = sharedUnit(issue.lines);
  const status = statusMeta(ISSUE_STATUS_META, issue.status);

  /** What actually went, per item — summed from the lines, because the header's
   * `totalQty` cannot describe metres and cones at once (§6.5). */
  const issuedByItem = (() => {
    const totals = new Map<string, { name: string; unit: string; qty: number }>();
    for (const line of issue.lines) {
      if (!line.item) continue;
      const key = line.item.id;
      const existing = totals.get(key) ?? {
        name: line.item.name,
        unit: line.uom ? (line.uom.symbol ?? line.uom.unitName) : '',
        qty: 0,
      };
      existing.qty += toNumber(line.qty);
      totals.set(key, existing);
    }
    return [...totals.values()];
  })();

  return (
    <div style={{ background: '#fff', minHeight: '100%' }}>
      <header className="detail-page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2
              className="detail-title"
              style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}
            >
              {issue.challanNumber}
            </h2>
            <span
              style={{
                padding: '2px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 500,
                color: status.color,
                background: status.bg,
              }}
            >
              {status.label}
            </span>
            {issue.isRework && (
              <span style={{ fontSize: 11, color: '#b45309' }}>
                Rework · attempt {issue.attemptNo}
              </span>
            )}
          </div>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {formatDate(issue.issueDate)} · {issue.processorNameSnapshot ?? 'in-house'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/**
           * 🔴 A DRAFT GETS A DIFFERENT SET, and Print is deliberately not in it.
           * A challan is the document that TRAVELS WITH THE GOODS; printing one
           * for material still in the godown puts a Rule 55 challan in somebody's
           * hand for a consignment that does not exist.
           */}
          {issue.status === 'draft' && (
            <>
              <button
                className="action-btn"
                type="button"
                onClick={() =>
                  navigate(`/organizations/${orgId}/jobwork/issues/new?draftId=${issue.id}`, {
                    state: { returnUrl: `/organizations/${orgId}/jobwork/issues` },
                  })
                }
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#333',
                }}
              >
                <span className="action-btn-text">Edit</span>
              </button>
              <button
                className="action-btn"
                type="button"
                onClick={() => postMutation.mutate()}
                disabled={postMutation.isPending}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  border: 'none',
                  borderRadius: 4,
                  background: postMutation.isPending ? '#93c5fd' : '#0062ff',
                  cursor: postMutation.isPending ? 'not-allowed' : 'pointer',
                  color: '#fff',
                  fontWeight: 500,
                }}
              >
                <span className="action-btn-text">
                  {postMutation.isPending ? 'Issuing…' : 'Issue challan'}
                </span>
              </button>
              <button
                className="action-btn"
                type="button"
                onClick={() => setDeleteOpen(true)}
                style={{
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid #fecaca',
                  borderRadius: 4,
                  background: '#fff',
                  cursor: 'pointer',
                  color: '#b91c1c',
                }}
              >
                <span className="action-btn-text">Delete</span>
              </button>
            </>
          )}
          {issue.status !== 'draft' && (
            <button
              className="action-btn"
              type="button"
              onClick={() => {
                const opened = printChallan(issue, orgName, trackingLabel.singular, unitLabel);
                if (!opened) {
                  setError(
                    'The print window was blocked. Allow pop-ups for this site and try again.',
                  );
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
                color: '#333',
              }}
            >
              <Printer size={14} />{' '}
              <span className="action-btn-text">
                <span className="action-btn-text">Print</span> challan
              </span>
            </button>
          )}
          {/* Cancelling posts reversing rows, so it only applies to a challan
              that posted some — a draft is deleted above instead. */}
          {issue.status !== 'cancelled' && issue.status !== 'draft' && (
            <button
              className="action-btn"
              type="button"
              onClick={() => setCancelOpen(true)}
              style={{
                padding: '6px 12px',
                fontSize: 13,
                border: '1px solid #fecaca',
                borderRadius: 4,
                background: '#fff',
                cursor: 'pointer',
                color: '#b91c1c',
              }}
            >
              <span className="action-btn-text">Cancel</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              border: '1px solid #e2e8f0',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {error && (
        <p
          style={{
            fontSize: 13,
            color: '#b91c1c',
            background: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            padding: '10px 24px',
            margin: 0,
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div style={{ padding: '20px 24px' }}>
        <div className="responsive-table-wrapper">
          <table style={{ borderCollapse: 'collapse', marginBottom: 20 }}>
            <tbody>
              <tr>
                <td style={rowLabel}>Job order</td>
                <td style={rowValue}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/organizations/${orgId}/jobwork/job-orders/${issue.jobOrderId}`)
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      font: 'inherit',
                      color: '#0062ff',
                      cursor: 'pointer',
                    }}
                  >
                    {issue.jobOrder?.jobOrderNumber ?? 'Open'}
                  </button>
                </td>
              </tr>
              <tr>
                <td style={rowLabel}>Step</td>
                <td style={rowValue}>
                  {issue.step ? `${issue.step.seq}. ${issue.step.processNameSnapshot}` : '-'}
                </td>
              </tr>
              <tr>
                {/* One line per ITEM on the challan (§5.7), each in its own unit —
                  they are never added together. There is no header item to fall
                  back to any more, and a challan with no lines carries nothing. */}
                <td style={rowLabel}>Items</td>
                <td style={rowValue}>
                  {issuedByItem.length === 0
                    ? '-'
                    : issuedByItem.map((row) => (
                        <span key={row.name} style={{ display: 'block' }}>
                          {row.name} · {formatQty(row.qty)} {row.unit}
                        </span>
                      ))}
                </td>
              </tr>
              <tr>
                <td style={rowLabel}>Moved</td>
                <td style={rowValue}>
                  {issue.sourceLocation?.name ?? '-'} → {issue.destination?.name ?? '-'}
                </td>
              </tr>
              {issue.toleranceOverrideReason && (
                <tr>
                  <td style={rowLabel}>Tolerance override</td>
                  <td style={{ ...rowValue, color: '#b45309' }}>{issue.toleranceOverrideReason}</td>
                </tr>
              )}
              {issue.remarks && (
                <tr>
                  <td style={rowLabel}>Remarks</td>
                  <td style={{ ...rowValue, whiteSpace: 'pre-wrap' }}>{issue.remarks}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ border: '1px solid #eef0f3', borderRadius: 4, overflow: 'hidden' }}>
          <div className="responsive-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                  {/*
                  🔴 ITEM, not "Party ref" and "Taka".

                  A challan carries several items now (§5.7), so which item each
                  line is was the one thing this table did not say. The two it
                  replaced said nothing: "Taka" is always blank because issuing is
                  batch-level, and "Party ref" is the supplier's own batch number,
                  which nothing can capture until Purchase Received records it
                  (spec §4.5). Both come back with the features that fill them.
                */}
                  <th style={th} scope="col">
                    Item
                  </th>
                  <th style={th} scope="col">
                    {trackingLabel.singular}
                  </th>
                  <th style={th} scope="col">
                    Quantity
                  </th>
                </tr>
              </thead>
              <tbody>
                {issue.lines.map((line) => (
                  <tr key={line.id} style={{ borderBottom: '1px solid #eef0f3' }}>
                    <td style={{ ...td, fontWeight: 500, color: '#111' }}>
                      {line.item?.name ?? '-'}
                    </td>
                    <td style={td}>{line.batch?.supplierBatchRef ?? '-'}</td>
                    <td style={td}>
                      {formatQty(line.qty)} {line.uom?.symbol ?? line.uom?.unitName ?? unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={cancelOpen}
        title="Cancel this challan"
        message={
          <div>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
              The stock moves back to {issue.sourceLocation?.name ?? 'its source'} by way of
              reversing entries — the original movements stay on record, because &ldquo;it went out
              on the 3rd and was cancelled on the 5th&rdquo; is a question someone will ask. This is
              not possible once goods have been received against it.
            </p>
            <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>
              Reason
            </label>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              aria-label="Reason for cancelling"
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                minHeight: 32,
              }}
            />
          </div>
        }
        confirmText={cancelMutation.isPending ? 'Cancelling…' : 'Cancel challan'}
        cancelText="Keep it"
        onConfirm={() => {
          if (cancelReason.trim()) cancelMutation.mutate();
        }}
        onCancel={() => {
          setCancelOpen(false);
          setCancelReason('');
        }}
      />

      {/* No reason is asked for, unlike a cancellation. A cancelled challan is
          history somebody will question; a deleted draft never happened, so there
          is nothing to explain. */}
      <ConfirmDialog
        isOpen={deleteOpen}
        title="Delete this draft"
        message={
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            {issue.challanNumber} has not been issued, so no stock has moved and there is nothing to
            reverse. The challan number stays used and will not be given to another challan.
          </p>
        }
        confirmText={deleteMutation.isPending ? 'Deleting…' : 'Delete draft'}
        cancelText="Keep it"
        onConfirm={() => deleteMutation.mutate()}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
