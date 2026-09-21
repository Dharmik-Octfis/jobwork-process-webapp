import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CheckSquare,
  Search,
  ExternalLink,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Inbox,
  User,
} from 'lucide-react';
import { approvalsApi } from './approvals.api';
import { useApprovalModules } from '../automation/approval-processes/api/approvalProcess.api';
import type { ModuleMetadata } from '../automation/approval-processes/types/approvalProcess.types';
import { resolveRecordRoute, getModuleBadgeStyle } from './approvalRoutes.helper';
import './ApprovalsListPage.css';

type TabKey = 'all' | 'pending' | 'my' | 'approved' | 'rejected';

export const ApprovalsListPage: React.FC = () => {
  const { orgId } = useParams<{ orgId: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('my');
  const [selectedModule, setSelectedModule] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const limit = 15;

  // Load modules dynamically
  const { data: modules = [] } = useApprovalModules(orgId);

  // Load approvals list with server-side pagination & filtering
  const { data, isLoading } = useQuery({
    queryKey: ['approvals-inbox', orgId, activeTab, selectedModule, search, page],
    queryFn: () =>
      approvalsApi.listRequests(orgId!, {
        tab: activeTab,
        moduleId: selectedModule === 'all' ? undefined : selectedModule,
        search: search.trim() || undefined,
        page,
        limit,
      }),
    enabled: Boolean(orgId),
  });

  const requests = data?.items || [];
  const totalPages = data?.totalPages || 1;
  const totalItems = data?.total || 0;

  return (
    <div className="approvals-inbox-page">
      {/* Header */}
      <div className="approvals-inbox-header">
        <div className="approvals-inbox-title">
          <h1>
            <CheckSquare size={26} color="#2563eb" />
            Approvals
          </h1>
          <p>Review, track, and manage approval requests across CRM modules</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="approvals-tabs-row">
        <button
          type="button"
          className={`approval-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('all');
            setPage(1);
          }}
        >
          All Requests
        </button>
        <button
          type="button"
          className={`approval-tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('pending');
            setPage(1);
          }}
        >
          <Clock size={15} />
          Pending
        </button>
        <button
          type="button"
          className={`approval-tab-btn ${activeTab === 'my' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('my');
            setPage(1);
          }}
        >
          <User size={15} />
          My Approvals
        </button>
        <button
          type="button"
          className={`approval-tab-btn ${activeTab === 'approved' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('approved');
            setPage(1);
          }}
        >
          <CheckCircle2 size={15} />
          Approved
        </button>
        <button
          type="button"
          className={`approval-tab-btn ${activeTab === 'rejected' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('rejected');
            setPage(1);
          }}
        >
          <XCircle size={15} />
          Rejected
        </button>
      </div>

      {/* Toolbar & Filters */}
      <div className="approvals-toolbar">
        {/* Module Pills Filter */}
        <div className="approvals-module-pills">
          <button
            type="button"
            className={`module-pill-btn ${selectedModule === 'all' ? 'active' : ''}`}
            onClick={() => {
              setSelectedModule('all');
              setPage(1);
            }}
          >
            All Modules
          </button>
          {modules.map((m: ModuleMetadata) => (
            <button
              key={m.id}
              type="button"
              className={`module-pill-btn ${
                selectedModule === m.code.toLowerCase() || selectedModule === m.id ? 'active' : ''
              }`}
              onClick={() => {
                setSelectedModule(m.code.toLowerCase());
                setPage(1);
              }}
            >
              {m.name}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="approvals-search-box">
          <Search size={15} color="#94a3b8" />
          <input
            type="text"
            placeholder="Search record or process..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Table Content */}
      <div className="approvals-table-container">
        {isLoading ? (
          <div className="approvals-empty-state">
            <div style={{ fontSize: 14 }}>Loading approval requests...</div>
          </div>
        ) : requests.length === 0 ? (
          <div className="approvals-empty-state">
            <div className="approvals-empty-icon">
              <Inbox size={26} />
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1e293b', margin: '0 0 6px 0' }}>
              No Approval Requests Found
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              There are no approval requests matching your current filter criteria.
            </p>
          </div>
        ) : (
          <table className="approvals-table">
            <thead>
              <tr>
                <th>Module</th>
                <th>Record Title</th>
                <th>Approval Process</th>
                <th>Stage & Approvers</th>
                <th>Requested By</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => {
                const badgeStyle = getModuleBadgeStyle(row.moduleId);
                const recordRoute = orgId
                  ? resolveRecordRoute(orgId, row.moduleId, row.recordId)
                  : '#';

                return (
                  <tr key={row.id}>
                    <td>
                      <span
                        className="module-badge"
                        style={{ background: badgeStyle.bg, color: badgeStyle.color }}
                      >
                        {badgeStyle.label}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: '#0f172a' }}>
                        {row.recordTitle || `Record ${row.recordId.slice(0, 8)}`}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: '#334155' }}>{row.processName}</div>
                    </td>
                    <td>
                      {row.currentStageName ? (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#2563eb' }}>
                            Stage {row.currentStageOrder || 1}: {row.currentStageName}
                          </div>
                          {row.currentStageApprovers && row.currentStageApprovers.length > 0 && (
                            <div style={{ fontSize: 11, color: '#64748b' }}>
                              {row.currentStageApprovers
                                .map((a) => a.fullName || a.email)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: '#475569' }}>
                        {row.requesterName || 'System'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {new Date(row.submittedAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td>
                      <span className={`status-chip ${row.status.toLowerCase()}`}>
                        {row.status === 'FINAL_APPROVED'
                          ? 'Approved'
                          : row.status === 'IN_PROGRESS'
                          ? 'Pending'
                          : row.status}
                      </span>
                    </td>
                    <td>
                      <div className="approvals-table-actions">
                        <Link
                          to={`/organizations/${orgId}/approvals/${row.id}`}
                          className="btn-table-action primary"
                        >
                          <span>Review</span>
                          <ChevronRight size={13} />
                        </Link>
                        <Link
                          to={recordRoute}
                          className="btn-table-action secondary"
                          title="View CRM Record"
                        >
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination Bar */}
        {!isLoading && totalItems > 0 && (
          <div className="approvals-pagination-bar">
            <div className="approvals-pagination-info">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, totalItems)} of {totalItems}{' '}
              requests
            </div>
            <div className="approvals-pagination-controls">
              <button
                type="button"
                className="btn-page-nav"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: 13, color: '#475569', padding: '0 8px' }}>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-page-nav"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ApprovalsListPage;
