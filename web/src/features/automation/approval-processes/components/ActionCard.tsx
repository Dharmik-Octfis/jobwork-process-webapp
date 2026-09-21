import { useState } from 'react';
import {
  Zap,
  Plus,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
} from 'lucide-react';
import type {
  ActionType,
  ApprovalActionConfig,
  FieldMetadata,
} from '../types/approvalProcess.types';
import type { Member } from '../../../members/members.api';
import { ActionConfigurationModal } from './ActionConfigurationModal';

interface ActionCardProps {
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

export function ActionCard({
  finalApprovalActions,
  rejectionActions,
  fields,
  members,
  onFinalApprovalActionsChange,
  onRejectionActionsChange,
}: ActionCardProps) {
  const [activeModal, setActiveModal] = useState<{
    target: 'approval' | 'rejection';
    actionType: ActionType;
  } | null>(null);

  const safeFinalActions = Array.isArray(finalApprovalActions) ? finalApprovalActions : [];
  const safeRejectionActions = Array.isArray(rejectionActions) ? rejectionActions : [];
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeMembers = Array.isArray(members) ? members : [];

  const handleSaveAction = (newAction: ApprovalActionConfig) => {
    if (!activeModal) return;
    if (activeModal.target === 'approval') {
      onFinalApprovalActionsChange([...safeFinalActions, newAction]);
    } else {
      onRejectionActionsChange([...safeRejectionActions, newAction]);
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
                    onClick={() => setActiveModal({ target: 'approval', actionType: type })}
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
                <div key={action.id || idx} className="ap-configured-item">
                  <span className="ap-configured-type-tag">{action.actionType.replace('_', ' ')}</span>
                  <span className="ap-configured-name">{action.name}</span>
                  <button
                    type="button"
                    className="ap-configured-del"
                    onClick={() => handleRemoveAction('approval', idx)}
                    aria-label="Remove configured action"
                  >
                    <Trash2 size={14} />
                  </button>
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
                    onClick={() => setActiveModal({ target: 'rejection', actionType: type })}
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
                <div key={action.id || idx} className="ap-configured-item">
                  <span className="ap-configured-type-tag">{action.actionType.replace('_', ' ')}</span>
                  <span className="ap-configured-name">{action.name}</span>
                  <button
                    type="button"
                    className="ap-configured-del"
                    onClick={() => handleRemoveAction('rejection', idx)}
                    aria-label="Remove configured action"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeModal && (
        <ActionConfigurationModal
          actionType={activeModal.actionType}
          fields={safeFields}
          members={safeMembers}
          onSave={handleSaveAction}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}
