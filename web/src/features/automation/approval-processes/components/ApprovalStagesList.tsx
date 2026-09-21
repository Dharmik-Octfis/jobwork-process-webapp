import { useMemo, useState } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { ApprovalStageCard } from './ApprovalStageCard';
import type {
  ApprovalStageConfig,
  ApprovalMode,
  FieldMetadata,
} from '../types/approvalProcess.types';
import type { Member } from '../../../members/members.api';
import type { Role } from '../../../roles/roles.api';

interface ApprovalStagesListProps {
  stages: ApprovalStageConfig[];
  fields: FieldMetadata[];
  members: Member[];
  roles: Role[];
  onChange: (updatedStages: ApprovalStageConfig[]) => void;
}

/** Check if a stage has an assigned approver */
function isStageComplete(stage: ApprovalStageConfig): boolean {
  if (!stage) return false;
  const def = stage.approverDefinition;
  if (!def) return false;
  if (def.type === 'USER') {
    return Array.isArray(def.userIds) && def.userIds.length > 0 && Boolean(def.userIds[0]);
  }
  if (def.type === 'ROLE') {
    return Array.isArray(def.roleIds) && def.roleIds.length > 0;
  }
  return true;
}

export function ApprovalStagesList({
  stages,
  fields,
  members,
  roles,
  onChange,
}: ApprovalStagesListProps) {
  const [showValidationBanner, setShowValidationBanner] = useState(false);
  const safeStages = Array.isArray(stages) ? stages : [];
  const commonMode: ApprovalMode = safeStages[0]?.approvalMode || 'ANYONE';

  const incompleteIndices = useMemo(() => {
    return safeStages
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !isStageComplete(s))
      .map(({ i }) => i);
  }, [safeStages]);

  // Map of userId -> array of stage indices
  const userToStagesMap = useMemo(() => {
    const map = new Map<string, number[]>();
    safeStages.forEach((s, idx) => {
      if (s.approverDefinition?.type === 'USER') {
        const uId = (s.approverDefinition?.userIds || [])[0];
        if (uId) {
          const list = map.get(uId) || [];
          list.push(idx);
          map.set(uId, list);
        }
      }
    });
    return map;
  }, [safeStages]);

  // Find duplicate stage indices
  const duplicateStageIndices = useMemo(() => {
    const dups = new Set<number>();
    userToStagesMap.forEach((indices) => {
      if (indices.length > 1) {
        indices.forEach((i) => dups.add(i));
      }
    });
    return Array.from(dups);
  }, [userToStagesMap]);

  const hasIncomplete = incompleteIndices.length > 0;
  const hasDuplicates = duplicateStageIndices.length > 0;

  const handleCommonModeChange = (newMode: ApprovalMode) => {
    const next = safeStages.map((s) => ({
      ...s,
      approvalMode: newMode,
    }));
    onChange(next);
  };

  const handleStageChange = (index: number, updated: ApprovalStageConfig) => {
    if (isStageComplete(updated) && incompleteIndices.length <= 1 && !hasDuplicates) {
      setShowValidationBanner(false);
    }
    const next = [...safeStages];
    next[index] = updated;
    onChange(next);
  };

  const handleAddStage = () => {
    if (hasIncomplete || hasDuplicates) {
      setShowValidationBanner(true);
      return;
    }
    setShowValidationBanner(false);

    const nextOrder = safeStages.length + 1;
    const newStage: ApprovalStageConfig = {
      id: `stage_${Date.now()}`,
      name: `Stage ${nextOrder}`,
      stageOrder: nextOrder,
      approverDefinition: {
        type: 'USER',
        userIds: [],
      },
      approvalMode: commonMode,
      recordModification: {
        allowApproverEditPending: true,
      },
      stageApprovalActions: [],
    };
    onChange([...safeStages, newStage]);
  };

  const handleDeleteStage = (index: number) => {
    if (safeStages.length <= 1) return;
    const filtered = safeStages
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stageOrder: i + 1, name: s.name || `Stage ${i + 1}` }));
    setShowValidationBanner(false);
    onChange(filtered);
  };

  return (
    <div className="ap-stages-container">
      <div className="ap-card-header">
        <h3 className="ap-card-title">Approval Stages</h3>
        <span className="ap-card-subtitle">
          Define multi-step approvers, sequential chains, and review permissions
        </span>
      </div>

      {/* Validation banner when user clicks add stage while previous stage has no user selected */}
      {showValidationBanner && hasIncomplete && (
        <div className="ap-criteria-validation-banner" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} className="ap-criteria-validation-icon" />
          <span>
            Please select an approver user for{' '}
            <strong>
              {incompleteIndices.length === 1
                ? `Stage ${incompleteIndices[0] + 1}`
                : `Stages ${incompleteIndices.map((i) => i + 1).join(', ')}`}
            </strong>{' '}
            before adding a new stage.
          </span>
        </div>
      )}

      {/* Validation banner for duplicate users */}
      {showValidationBanner && hasDuplicates && (
        <div className="ap-criteria-validation-banner" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} className="ap-criteria-validation-icon" />
          <span>
            The same approver user cannot be assigned to multiple stages in this rule. Please assign a different user.
          </span>
        </div>
      )}

      <div className="ap-stages-chain">
        {safeStages.map((stage, idx) => {
          // Find users assigned to OTHER stages in this rule
          const assignedUsersInOtherStages = safeStages
            .map((s, sIdx) => {
              if (sIdx === idx) return null;
              if (s.approverDefinition?.type === 'USER') {
                const uId = (s.approverDefinition?.userIds || [])[0];
                if (uId) {
                  return {
                    userId: uId,
                    stageIndex: sIdx,
                    stageName: s.name || `Stage ${sIdx + 1}`,
                  };
                }
              }
              return null;
            })
            .filter((u): u is { userId: string; stageIndex: number; stageName: string } => u !== null);

          const currentUId = (stage.approverDefinition?.userIds || [])[0];
          const duplicateWith = currentUId && (userToStagesMap.get(currentUId) || []).length > 1
            ? (userToStagesMap.get(currentUId) || []).filter((i) => i !== idx)
            : [];
          const duplicateErrorMsg = duplicateWith.length > 0
            ? `This user is also assigned to Stage ${duplicateWith.map((i) => i + 1).join(', ')}. Each stage must have a different approver.`
            : undefined;

          return (
            <div key={stage.id || idx} className="ap-stage-wrapper">
              <ApprovalStageCard
                stage={stage}
                index={idx}
                totalStages={safeStages.length}
                fields={fields}
                members={members}
                roles={roles}
                assignedUsersInOtherStages={assignedUsersInOtherStages}
                isInvalid={showValidationBanner && incompleteIndices.includes(idx)}
                duplicateError={duplicateErrorMsg}
                onChange={(upd) => handleStageChange(idx, upd)}
                onDelete={() => handleDeleteStage(idx)}
              />
              {idx < safeStages.length - 1 && (
                <div className="ap-stage-connector" aria-hidden="true">
                  <div className="ap-connector-line" />
                  <div className="ap-connector-arrow">↓</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="ap-stages-footer">
        <button
          type="button"
          className={`ap-button ap-button-secondary ap-add-stage-btn${hasIncomplete || hasDuplicates ? ' is-disabled' : ''}`}
          onClick={handleAddStage}
          title={
            hasIncomplete
              ? 'Select approver user for existing stage before adding a new stage'
              : hasDuplicates
              ? 'Resolve duplicate approver users before adding a new stage'
              : undefined
          }
        >
          <Plus size={16} /> Add Approval Stage
        </button>
      </div>

      {/* Common Approval Condition at the end of the stage list */}
      <div className="ap-stages-common-condition">
        <div className="ap-form-group">
          <label className="ap-label">Approval Condition</label>
          <div className="ap-radio-inline-group">
            <label className="ap-radio-inline">
              <input
                type="radio"
                name="common_stage_approval_mode"
                value="ANYONE"
                checked={commonMode === 'ANYONE'}
                onChange={() => handleCommonModeChange('ANYONE')}
              />
              <span>Anyone from the list</span>
            </label>

            <label className="ap-radio-inline">
              <input
                type="radio"
                name="common_stage_approval_mode"
                value="EVERYONE"
                checked={commonMode === 'EVERYONE'}
                onChange={() => handleCommonModeChange('EVERYONE')}
              />
              <span>Everyone from the list</span>
            </label>

            <label className="ap-radio-inline">
              <input
                type="radio"
                name="common_stage_approval_mode"
                value="SEQUENTIAL"
                checked={commonMode === 'SEQUENTIAL'}
                onChange={() => handleCommonModeChange('SEQUENTIAL')}
              />
              <span>Sequential order</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
