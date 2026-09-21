import { useState } from 'react';
import { Trash2, Plus, ChevronDown, ChevronUp, Check, Shield } from 'lucide-react'; // Check kept for ROLE pills
import type {
  ApprovalStageConfig,
  ApproverType,
  FieldMetadata,
  ApprovalActionConfig,
} from '../types/approvalProcess.types';
import type { Member } from '../../../members/members.api';
import type { Role } from '../../../roles/roles.api';
import { ActionConfigurationModal } from './ActionConfigurationModal';

export interface AssignedUserInOtherStage {
  userId: string;
  stageIndex: number;
  stageName: string;
}

interface ApprovalStageCardProps {
  stage: ApprovalStageConfig;
  index: number;
  totalStages: number;
  fields: FieldMetadata[];
  members: Member[];
  roles: Role[];
  assignedUsersInOtherStages?: AssignedUserInOtherStage[];
  isInvalid?: boolean;
  duplicateError?: string;
  onChange: (updated: ApprovalStageConfig) => void;
  onDelete: () => void;
}

export function ApprovalStageCard({
  stage,
  index,
  totalStages,
  fields,
  members,
  roles,
  assignedUsersInOtherStages = [],
  isInvalid = false,
  duplicateError,
  onChange,
  onDelete,
}: ApprovalStageCardProps) {
  const [showRecordMod, setShowRecordMod] = useState(false);
  const [addingAction, setAddingAction] = useState(false);

  const approverDef = stage?.approverDefinition || { type: 'USER', userIds: [], roleIds: [] };
  const approverType = approverDef.type || 'USER';

  const safeMembers = Array.isArray(members) ? members : [];
  const safeRoles = Array.isArray(roles) ? roles : [];
  const safeActions = Array.isArray(stage?.stageApprovalActions) ? stage.stageApprovalActions : [];

  const currentUserId = (approverDef.userIds || [])[0];
  const isUserMissing = approverType === 'USER' && !currentUserId;
  const isDuplicate = Boolean(duplicateError);

  const handleApproverTypeChange = (newType: ApproverType) => {
    onChange({
      ...stage,
      approverDefinition: {
        type: newType,
        userIds: newType === 'USER' ? [] : undefined,
        roleIds: newType === 'ROLE' ? [] : undefined,
      },
    });
  };

  const handleUserSelect = (userId: string) => {
    onChange({
      ...stage,
      approverDefinition: {
        ...approverDef,
        userIds: userId ? [userId] : [],
      },
    });
  };

  const handleRoleToggle = (roleId: string) => {
    const current = approverDef.roleIds || [];
    const updated = current.includes(roleId)
      ? current.filter((id: string) => id !== roleId)
      : [...current, roleId];
    onChange({
      ...stage,
      approverDefinition: {
        ...approverDef,
        roleIds: updated,
      },
    });
  };

  const handleAddStageAction = (action: ApprovalActionConfig) => {
    const currentActions = stage.stageApprovalActions || [];
    onChange({
      ...stage,
      stageApprovalActions: [...currentActions, action],
    });
  };

  const handleRemoveStageAction = (actionIdx: number) => {
    const currentActions = stage.stageApprovalActions || [];
    onChange({
      ...stage,
      stageApprovalActions: currentActions.filter((_: ApprovalActionConfig, i: number) => i !== actionIdx),
    });
  };

  return (
    <div className={`ap-stage-card${(isInvalid && isUserMissing) || isDuplicate ? ' is-invalid-stage' : ''}`} data-stage-index={index}>
      {/* Stage Header */}
      <div className="ap-stage-card-header">
        <div className="ap-stage-title-group">
          <span className="ap-stage-badge">Stage {index + 1}</span>
          <input
            type="text"
            className="ap-stage-name-input"
            value={stage.name}
            onChange={(e) => onChange({ ...stage, name: e.target.value })}
            placeholder={`Stage ${index + 1} Name`}
            aria-label={`Stage ${index + 1} Name`}
          />
        </div>

        {totalStages > 1 && (
          <button
            type="button"
            className="ap-icon-button ap-stage-delete-btn"
            onClick={onDelete}
            title="Delete this stage"
            aria-label="Delete this stage"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      <div className="ap-stage-body">
        {/* Approver Selection Row */}
        <div className="ap-form-row">
          <div className="ap-form-group ap-col-4">
            <label className="ap-label">Approver Type</label>
            <select
              className="ap-select"
              value={approverType}
              onChange={(e) => handleApproverTypeChange(e.target.value as ApproverType)}
            >
              <option value="USER">Users</option>
              {/* <option value="ROLE">Roles</option>
              <option value="REPORTING_MANAGER">Reporting Manager</option>
              <option value="RECORD_OWNER">Record Owner</option>
              <option value="RECORD_CREATOR">Record Creator</option> */}
            </select>
          </div>

          <div className="ap-form-group ap-col-8">
            {approverType === 'USER' && (
              <>
                <label className="ap-label">
                  Select User <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
                </label>
                <select
                  className={`ap-select ${(isInvalid && isUserMissing) || isDuplicate ? 'is-invalid' : ''}`}
                  value={currentUserId || ''}
                  onChange={(e) => handleUserSelect(e.target.value)}
                  aria-label="Select approver user"
                >
                  <option value="">— Select a user —</option>
                  {safeMembers.map((m) => {
                    const otherStage = assignedUsersInOtherStages.find((u) => u.userId === m.userId);
                    const isAssignedElsewhere = Boolean(otherStage);
                    return (
                      <option
                        key={m.userId}
                        value={m.userId}
                        disabled={isAssignedElsewhere}
                      >
                        {m.fullName || m.email}
                        {isAssignedElsewhere ? ` (Assigned to ${otherStage!.stageName || `Stage ${otherStage!.stageIndex + 1}`})` : ''}
                      </option>
                    );
                  })}
                </select>
                {isInvalid && isUserMissing && (
                  <span style={{ fontSize: '12px', color: 'var(--color-danger, #ef4444)', marginTop: '4px', display: 'block' }}>
                    Please select an approver user for this stage
                  </span>
                )}
                {isDuplicate && duplicateError && (
                  <span style={{ fontSize: '12px', color: 'var(--color-danger, #ef4444)', marginTop: '4px', display: 'block' }}>
                    {duplicateError}
                  </span>
                )}
                {safeMembers.length === 0 && (
                  <span className="ap-text-muted" style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
                    No users available
                  </span>
                )}
              </>
            )}

            {approverType === 'ROLE' && (
              <>
                <label className="ap-label">Select Roles</label>
                <div className="ap-pill-picker">
                  {safeRoles.length === 0 ? (
                    <span className="ap-text-muted">No roles found</span>
                  ) : (
                    safeRoles.map((r) => {
                      const selected = (approverDef.roleIds || []).includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`ap-pill-item ${selected ? 'is-selected' : ''}`}
                          onClick={() => handleRoleToggle(r.id)}
                        >
                          {selected && <Check size={12} />}
                          <span>{r.name}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {(approverType === 'REPORTING_MANAGER' ||
              approverType === 'RECORD_OWNER' ||
              approverType === 'RECORD_CREATOR') && (
                <div className="ap-dynamic-approver-note">
                  <Shield size={16} />
                  <span>
                    Dynamic Approver: Automatically resolved to the {approverType.replace('_', ' ').toLowerCase()}{' '}
                    of the record at runtime.
                  </span>
                </div>
              )}
          </div>
        </div>

        {/* Action on Approval (Stage Level) */}
        <div className="ap-stage-actions-section">
          <div className="ap-stage-actions-header">
            <span className="ap-subheading">Action on Approval</span>
            <button
              type="button"
              className="ap-text-button"
              onClick={() => setAddingAction(true)}
            >
              <Plus size={14} /> Action on Approval
            </button>
          </div>

          {safeActions.length > 0 ? (
            <div className="ap-action-pills-list">
              {safeActions.map((act: ApprovalActionConfig, idx: number) => (
                <div key={act.id || idx} className="ap-action-pill">
                  <span className="ap-action-pill-name">{act.name}</span>
                  <button
                    type="button"
                    className="ap-action-pill-remove"
                    onClick={() => handleRemoveStageAction(idx)}
                    aria-label="Remove action"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="ap-empty-stage-action">No actions configured for this stage yet</div>
          )}
        </div>

        {/* Collapsible Record Modification Settings */}
        <div className="ap-record-mod-container">
          <button
            type="button"
            className="ap-record-mod-toggle"
            onClick={() => setShowRecordMod(!showRecordMod)}
          >
            <span>Record Modification Settings</span>
            {showRecordMod ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showRecordMod && (
            <div className="ap-record-mod-content">
              <label className="ap-checkbox-label">
                <input
                  type="checkbox"
                  checked={stage.recordModification?.allowApproverEditPending ?? true}
                  onChange={(e) =>
                    onChange({
                      ...stage,
                      recordModification: {
                        ...stage.recordModification,
                        allowApproverEditPending: e.target.checked,
                      },
                    })
                  }
                />
                <span>Allow approvers to edit this record while pending approval</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {addingAction && (
        <ActionConfigurationModal
          actionType="UPDATE_FIELDS"
          fields={fields}
          members={members}
          onSave={handleAddStageAction}
          onClose={() => setAddingAction(false)}
        />
      )}
    </div>
  );
}
