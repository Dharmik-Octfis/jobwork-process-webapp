import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  ArrowUpDown,
  MoreVertical,
  Edit2,
  Copy,
  Trash2,
  Workflow,
  AlertCircle,
} from 'lucide-react';
import {
  useApprovalProcesses,
  useApprovalModules,
  useActivateApprovalProcess,
  useDeactivateApprovalProcess,
  useDuplicateApprovalProcess,
  useDeleteApprovalProcess,
} from './api/approvalProcess.api';
import { CreateApprovalProcessModal } from './components/CreateApprovalProcessModal';
import { ReorderProcessesModal } from './components/ReorderProcessesModal';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import type { ApprovalProcessListItem, ModuleMetadata } from './types/approvalProcess.types';
import './ApprovalProcessListPage.css';

interface ProcessRowActionMenuProps {
  process: ApprovalProcessListItem;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function ProcessRowActionMenu({
  process,
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
}: ProcessRowActionMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [openUpward, setOpenUpward] = useState(false);

  useEffect(() => {
    if (isOpen && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // If remaining viewport space below the button is less than 160px, open upwards
      setOpenUpward(spaceBelow < 160);
    }
  }, [isOpen]);

  return (
    <div
      ref={anchorRef}
      className={`ap-action-menu-anchor ${isOpen ? 'is-open' : ''}`}
    >
      <button
        type="button"
        className={`ap-icon-button ${isOpen ? 'active' : ''}`}
        onClick={onToggle}
        aria-label={`Actions for ${process.name}`}
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen && (
        <div
          className={`ap-action-menu-dropdown ${openUpward ? 'is-upward' : ''}`}
          role="menu"
        >
          <button
            type="button"
            className="ap-menu-item"
            role="menuitem"
            onClick={() => {
              onClose();
              onEdit();
            }}
          >
            <Edit2 size={14} />
            <span>Edit Process</span>
          </button>
          <button
            type="button"
            className="ap-menu-item"
            role="menuitem"
            onClick={() => {
              onClose();
              onDuplicate();
            }}
          >
            <Copy size={14} />
            <span>Duplicate</span>
          </button>
          <button
            type="button"
            className="ap-menu-item is-danger"
            role="menuitem"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function ApprovalProcessListPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReorderModal, setShowReorderModal] = useState(false);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: rawModules } = useApprovalModules(orgId);
  const modules: ModuleMetadata[] = Array.isArray(rawModules)
    ? rawModules
    : Array.isArray((rawModules as any)?.modules)
    ? (rawModules as any).modules
    : [];

  const {
    data: rawProcesses,
    isLoading,
    error,
  } = useApprovalProcesses(orgId, {
    search: search || undefined,
    moduleId: selectedModule || undefined,
  });

  const processes: ApprovalProcessListItem[] = Array.isArray(rawProcesses)
    ? rawProcesses
    : Array.isArray((rawProcesses as any)?.items)
    ? (rawProcesses as any).items
    : [];

  const activateMutation = useActivateApprovalProcess(orgId);
  const deactivateMutation = useDeactivateApprovalProcess(orgId);
  const duplicateMutation = useDuplicateApprovalProcess(orgId);
  const deleteMutation = useDeleteApprovalProcess(orgId);

  const currentModuleObj = modules.find((m) => m.id === selectedModule);
  const currentModuleName = currentModuleObj?.name;
  const canReorder = Boolean(selectedModule) && processes.length > 1;
  const reorderTooltip = !selectedModule
    ? 'Select a specific module from the filter to reorder its approval processes'
    : processes.length <= 1
    ? 'At least 2 approval processes are required in this module to reorder'
    : `Reorder approval processes for ${currentModuleName}`;

  const handleToggleStatus = async (item: ApprovalProcessListItem) => {
    if (item.status === 'ACTIVE') {
      await deactivateMutation.mutateAsync(item.id);
    } else {
      await activateMutation.mutateAsync(item.id);
    }
  };

  const handleDuplicate = async (item: ApprovalProcessListItem) => {
    setActionMenuOpenId(null);
    await duplicateMutation.mutateAsync(item.id);
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
    setDeleteConfirmId(null);
    setActionMenuOpenId(null);
  };

  // Close popup automatically when clicking outside or pressing Escape
  useEffect(() => {
    if (!actionMenuOpenId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.ap-action-menu-anchor')) {
        setActionMenuOpenId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionMenuOpenId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionMenuOpenId]);

  return (
    <div className="ap-list-page-container">
      {/* Top Header */}
      <header className="ap-list-header">
        <div className="ap-list-header-info">
          <div className="ap-title-with-icon">
            <Workflow className="ap-header-icon" size={22} />
            <h1 className="ap-page-title">Approval Process</h1>
          </div>
          <p className="ap-page-subtitle">
            Configure dynamic rules that require approvals for records created or updated by your team.
          </p>
        </div>

        <div className="ap-list-header-actions">
          <button
            type="button"
            className="ap-button ap-button-secondary"
            onClick={() => setShowReorderModal(true)}
            disabled={!canReorder}
            title={reorderTooltip}
          >
            <ArrowUpDown size={15} /> Reorder
          </button>

          <button
            type="button"
            className="ap-button ap-button-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={16} /> Create Approval Process
          </button>
        </div>
      </header>

      {/* Filter and Search Toolbar */}
      <div className="ap-list-toolbar">
        <div className="ap-search-box">
          <Search size={16} className="ap-search-icon" />
          <input
            type="search"
            className="ap-search-input"
            placeholder="Search Approval Process..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="ap-filter-group">
          <label htmlFor="module-filter-select" className="ap-filter-label">Module:</label>
          <select
            id="module-filter-select"
            className="ap-select ap-module-filter-select"
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
          >
            <option value="">All Modules</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Table Area */}
      <main className="ap-table-container">
        {isLoading ? (
          <div className="ap-list-loading">
            <div className="ap-spinner" />
            <p>Loading approval processes...</p>
          </div>
        ) : error ? (
          <div className="ap-list-error">
            <AlertCircle size={24} />
            <p>Error loading approval processes.</p>
          </div>
        ) : processes.length === 0 ? (
          <div className="ap-empty-state">
            <div className="ap-empty-icon-wrap">
              <Workflow size={40} />
            </div>
            <h2 className="ap-empty-title">No Approval Processes configured</h2>
            <p className="ap-empty-desc">
              {search || selectedModule
                ? 'No approval processes match your current filter criteria.'
                : 'Create an approval process to automate managerial reviews and field validation.'}
            </p>
            <button
              type="button"
              className="ap-button ap-button-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} /> Create Approval Process
            </button>
          </div>
        ) : (
          <table className="ap-table">
            <thead>
              <tr>
                <th className="ap-th-name">Process Name</th>
                <th className="ap-th-module">Module</th>
                <th className="ap-th-trigger">Trigger</th>
                <th className="ap-th-rules">Rules</th>
                <th className="ap-th-status">Active</th>
                <th className="ap-th-modified">Modified</th>
                <th className="ap-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {processes.map((p) => {
                const isActive = p.status === 'ACTIVE';
                const isMenuOpen = actionMenuOpenId === p.id;
                return (
                  <tr key={p.id} className="ap-table-row">
                    <td className="ap-td-name">
                      <button
                        type="button"
                        className="ap-table-link"
                        onClick={() =>
                          navigate(
                            `/organizations/${orgId}/settings/automation/approval-processes/${p.id}/edit`,
                          )
                        }
                      >
                        {p.name}
                      </button>
                      {p.description && (
                        <span className="ap-row-desc">{p.description}</span>
                      )}
                    </td>

                    <td className="ap-td-module">
                      <span className="ap-table-module-pill">{p.moduleName}</span>
                    </td>

                    <td className="ap-td-trigger">
                      <span className="ap-trigger-label">
                        {p.triggerType === 'CREATE_OR_EDIT'
                          ? 'Create or Edit'
                          : p.triggerType === 'CREATE_ONLY'
                          ? 'Create'
                          : 'Edit'}
                      </span>
                    </td>

                    <td className="ap-td-rules">
                      <span className="ap-rules-count-badge">
                        {p.rulesCount} {p.rulesCount === 1 ? 'Rule' : 'Rules'}
                      </span>
                    </td>

                    <td className="ap-td-status">
                      <label className="ap-switch">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => handleToggleStatus(p)}
                        />
                        <span className="ap-slider" />
                      </label>
                    </td>

                    <td className="ap-td-modified">
                      <span className="ap-modified-text">
                        {new Date(p.updatedAt).toLocaleDateString()}
                      </span>
                    </td>

                    <td className="ap-td-actions">
                      <ProcessRowActionMenu
                        process={p}
                        isOpen={isMenuOpen}
                        onToggle={() =>
                          setActionMenuOpenId(isMenuOpen ? null : p.id)
                        }
                        onClose={() => setActionMenuOpenId(null)}
                        onEdit={() =>
                          navigate(
                            `/organizations/${orgId}/settings/automation/approval-processes/${p.id}/edit`,
                          )
                        }
                        onDuplicate={() => handleDuplicate(p)}
                        onDelete={() => setDeleteConfirmId(p.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>

      {/* Create Modal */}
      {showCreateModal && orgId && (
        <CreateApprovalProcessModal
          orgId={orgId}
          initialModuleId={selectedModule || undefined}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Reorder Modal */}
      {showReorderModal && orgId && (
        <ReorderProcessesModal
          orgId={orgId}
          processes={processes}
          moduleName={currentModuleName}
          onClose={() => setShowReorderModal(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={Boolean(deleteConfirmId)}
        title="Delete Approval Process"
        message="Are you sure you want to delete this approval process? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isConfirming={deleteMutation.isPending}
        onConfirm={() => deleteConfirmId && handleDelete(deleteConfirmId)}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  );
}
