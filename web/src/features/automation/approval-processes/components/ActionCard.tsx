import { useState } from 'react';
import {
  Zap,
  Plus,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  Eye,
} from 'lucide-react';
import type {
  ActionType,
  ApprovalActionConfig,
  FieldMetadata,
} from '../types/approvalProcess.types';
import type { Member } from '../../../members/members.api';
import { ActionConfigurationModal } from './ActionConfigurationModal';

interface ActionCardProps {
  orgId?: string;
  finalApprovalActions: ApprovalActionConfig[];
  rejectionActions: ApprovalActionConfig[];
  fields: FieldMetadata[];
  members: Member[];
  onFinalApprovalActionsChange: (actions: ApprovalActionConfig[]) => void;
  onRejectionActionsChange: (actions: ApprovalActionConfig[]) => void;
}

const ACTION_CATALOG: { type: ActionType; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  // { type: 'ASSIGN_TASK', label: 'Assign Task', icon: CheckSquare },
  { type: 'UPDATE_FIELDS', label: 'Update Fields', icon: Edit3 },
  // { type: 'EMAIL_NOTIFICATION', label: 'Email Notifications', icon: Mail },
  // { type: 'IN_APP_NOTIFICATION', label: 'In-App Notification', icon: Bell },
  // { type: 'WEBHOOK', label: 'Webhooks', icon: Globe },
  // { type: 'FUNCTION', label: 'Functions', icon: Code2 },
];

/**
 * Describes which action is currently open in the modal, either for ADD or EDIT.
 * When editIndex is defined, the modal is in edit mode and Save will replace
 * the action at that index instead of appending.
 */
interface ActiveModal {
  target: 'approval' | 'rejection';
  actionType: ActionType;
  editIndex?: number;
  initialAction?: ApprovalActionConfig;
}

export function ActionCard({
  orgId,
  finalApprovalActions,
  rejectionActions,
  fields,
  members,
  onFinalApprovalActionsChange,
  onRejectionActionsChange,
}: ActionCardProps) {
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);

  const safeFinalActions = Array.isArray(finalApprovalActions) ? finalApprovalActions : [];
  const safeRejectionActions = Array.isArray(rejectionActions) ? rejectionActions : [];
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeMembers = Array.isArray(members) ? members : [];

  /** Opens modal to add a brand-new action */
  const openAddModal = (target: 'approval' | 'rejection', actionType: ActionType) => {
    setActiveModal({ target, actionType });
  };

  /** Opens modal pre-filled with existing action data for editing */
  const openEditModal = (
    target: 'approval' | 'rejection',
    action: ApprovalActionConfig,
    idx: number,
  ) => {
    setActiveModal({
      target,
      actionType: action.actionType,
      editIndex: idx,
      initialAction: action,
    });
  };

  const handleSaveAction = (updatedAction: ApprovalActionConfig) => {
    if (!activeModal) return;

    const isEdit = activeModal.editIndex !== undefined;

    if (activeModal.target === 'approval') {
      if (isEdit) {
        // Replace the action at editIndex
        const updated = [...safeFinalActions];
        updated[activeModal.editIndex!] = updatedAction;
        onFinalApprovalActionsChange(updated);
      } else {
        onFinalApprovalActionsChange([...safeFinalActions, updatedAction]);
      }
    } else {
      if (isEdit) {
        const updated = [...safeRejectionActions];
        updated[activeModal.editIndex!] = updatedAction;
        onRejectionActionsChange(updated);
      } else {
        onRejectionActionsChange([...safeRejectionActions, updatedAction]);
      }
    }
    setActiveModal(null);
  };

  const handleRemoveAction = (target: 'approval' | 'rejection', index: number) => {
    if (target === 'approval') {
      onFinalApprovalActionsChange(safeFinalActions.filter((_, i) => i !== index));
    } else {
      onRejectionActionsChange(safeRejectionActions.filter((_, i) => i !== index));
    }
  };

  /** Returns a short human-friendly summary of what the action does */
  const getActionSummary = (action: ApprovalActionConfig): string => {
    if (action.actionType === 'UPDATE_FIELDS') {
      const fieldName = (action.config?.fieldName as string) || (action.config?.fieldId as string) || 'field';
      const value = action.config?.value;
      if (value !== undefined && value !== '') {
        return `Set "${fieldName}" → ${String(value)}`;
      }
      return `Update "${fieldName}"`;
    }
    return action.name || action.actionType.replace(/_/g, ' ');
  };

  return (
    <div className="ap-final-actions-container">
      {/* Connector Header with Lightning Bolt */}
      <div className="ap-lightning-header">
        <div className="ap-lightning-circle">
          <Zap size={18} />
        </div>
        <h3 className="ap-final-actions-title">Final Actions</h3>
      </div>

      {/* Dual Side-by-Side Cards (Final Approval vs Rejection) */}
      <div className="ap-dual-actions-grid">
        {/* Left: Action on Final Approval */}
        <div className="ap-action-branch-card is-approval">
          <div className="ap-branch-header">
            <div className="ap-branch-title-wrap">
              <CheckCircle2 size={16} className="ap-branch-icon is-approval" />
              <h4 className="ap-branch-title">Action on Final Approval</h4>
            </div>
            <span className="ap-branch-count">{safeFinalActions.length} configured</span>
          </div>

          <div className="ap-branch-types-list">
            {ACTION_CATALOG.map(({ type, label, icon: Icon }) => {
              return (
                <div key={type} className="ap-action-type-row">
                  <div className="ap-action-type-label">
                    <Icon size={16} />
                    <span>{label}</span>
                  </div>
                  <button
                    type="button"
                    className="ap-action-add-btn"
                    onClick={() => openAddModal('approval', type)}
                    title={`Add ${label}`}
                    aria-label={`Add ${label} on final approval`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Configured Actions List */}
          {safeFinalActions.length > 0 && (
            <div className="ap-configured-actions-list">
              <div className="ap-configured-heading">Configured Final Actions:</div>
              {safeFinalActions.map((action, idx) => (
                <div
                  key={action.id || idx}
                  className="ap-configured-item ap-configured-item--clickable"
                  onClick={() => openEditModal('approval', action, idx)}
                  title="Click to view / edit this action"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openEditModal('approval', action, idx);
                  }}
                >
                  <span className="ap-configured-type-tag">
                    {action.actionType.replace(/_/g, ' ')}
                  </span>
                  <div className="ap-configured-body">
                    <span className="ap-configured-name">{action.name}</span>
                    <span className="ap-configured-summary">{getActionSummary(action)}</span>
                  </div>
                  <div className="ap-configured-actions-btns">
                    <button
                      type="button"
                      className="ap-configured-edit"
                      onClick={(e) => { e.stopPropagation(); openEditModal('approval', action, idx); }}
                      aria-label="Edit configured action"
                      title="Edit"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      type="button"
                      className="ap-configured-del"
                      onClick={(e) => { e.stopPropagation(); handleRemoveAction('approval', idx); }}
                      aria-label="Remove configured action"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Action on Rejection */}
        <div className="ap-action-branch-card is-rejection">
          <div className="ap-branch-header">
            <div className="ap-branch-title-wrap">
              <XCircle size={16} className="ap-branch-icon is-rejection" />
              <h4 className="ap-branch-title">Action on Rejection</h4>
            </div>
            <span className="ap-branch-count">{safeRejectionActions.length} configured</span>
          </div>

          <div className="ap-branch-types-list">
            {ACTION_CATALOG.map(({ type, label, icon: Icon }) => {
              return (
                <div key={type} className="ap-action-type-row">
                  <div className="ap-action-type-label">
                    <Icon size={16} />
                    <span>{label}</span>
                  </div>
                  <button
                    type="button"
                    className="ap-action-add-btn"
                    onClick={() => openAddModal('rejection', type)}
                    title={`Add ${label}`}
                    aria-label={`Add ${label} on rejection`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Configured Actions List */}
          {safeRejectionActions.length > 0 && (
            <div className="ap-configured-actions-list">
              <div className="ap-configured-heading">Configured Rejection Actions:</div>
              {safeRejectionActions.map((action, idx) => (
                <div
                  key={action.id || idx}
                  className="ap-configured-item ap-configured-item--clickable"
                  onClick={() => openEditModal('rejection', action, idx)}
                  title="Click to view / edit this action"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') openEditModal('rejection', action, idx);
                  }}
                >
                  <span className="ap-configured-type-tag">
                    {action.actionType.replace(/_/g, ' ')}
                  </span>
                  <div className="ap-configured-body">
                    <span className="ap-configured-name">{action.name}</span>
                    <span className="ap-configured-summary">{getActionSummary(action)}</span>
                  </div>
                  <div className="ap-configured-actions-btns">
                    <button
                      type="button"
                      className="ap-configured-edit"
                      onClick={(e) => { e.stopPropagation(); openEditModal('rejection', action, idx); }}
                      aria-label="Edit configured action"
                      title="Edit"
                    >
                      <Eye size={13} />
                    </button>
                    <button
                      type="button"
                      className="ap-configured-del"
                      onClick={(e) => { e.stopPropagation(); handleRemoveAction('rejection', idx); }}
                      aria-label="Remove configured action"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeModal && (
        <ActionConfigurationModal
          orgId={orgId}
          actionType={activeModal.actionType}
          initialAction={activeModal.initialAction}
          fields={safeFields}
          members={safeMembers}
          onSave={handleSaveAction}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}
