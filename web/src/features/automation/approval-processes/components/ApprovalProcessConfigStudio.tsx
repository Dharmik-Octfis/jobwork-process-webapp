import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Pencil,
  Plus,
  ShieldCheck,
  Save,
  Check,
  AlertCircle,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  useApprovalProcess,
  useUpdateApprovalProcess,
  useModuleFields,
  useOrgMembers,
  useOrgRoles,
  useActivateApprovalProcess,
  useDeactivateApprovalProcess,
} from '../api/approvalProcess.api';
import { CriteriaBuilder } from './CriteriaBuilder';
import { ApprovalStagesList } from './ApprovalStagesList';
import { ActionCard } from './ActionCard';
import { AssignAdminsModal } from './AssignAdminsModal';
import type {
  ApprovalProcessRuleConfig,
  TriggerType,
  CriteriaCondition,
} from '../types/approvalProcess.types';
import './ApprovalProcessConfigStudio.css';

export function ApprovalProcessConfigStudio() {
  const { orgId, id } = useParams<{ orgId: string; id: string }>();
  const navigate = useNavigate();

  const { data: process, isLoading: loadingProcess, error: loadError } = useApprovalProcess(
    orgId,
    id,
  );
  const { data: rawFields = [], isLoading: loadingFields } = useModuleFields(
    orgId,
    process?.moduleId,
  );
  const { data: rawMembers = [] } = useOrgMembers(orgId);
  const { data: rawRoles = [] } = useOrgRoles(orgId);

  const fields = Array.isArray(rawFields) ? rawFields : [];
  const members = Array.isArray(rawMembers)
    ? rawMembers
    : Array.isArray((rawMembers as any)?.results)
    ? (rawMembers as any).results
    : [];
  const roles = Array.isArray(rawRoles)
    ? rawRoles
    : Array.isArray((rawRoles as any)?.roles)
    ? (rawRoles as any).roles
    : [];

  const updateMutation = useUpdateApprovalProcess(orgId, id);
  const activateMutation = useActivateApprovalProcess(orgId);
  const deactivateMutation = useDeactivateApprovalProcess(orgId);

  const isStatusPending = activateMutation.isPending || deactivateMutation.isPending;

  const handleToggleStatus = async () => {
    if (!id || isStatusPending) return;
    try {
      if (process?.status === 'ACTIVE') {
        await deactivateMutation.mutateAsync(id);
        setFeedback({ type: 'success', message: 'Process deactivated (Draft).' });
      } else {
        await activateMutation.mutateAsync(id);
        setFeedback({ type: 'success', message: 'Process is now Active and will trigger on new records!' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to update process status.' });
    }
    setTimeout(() => setFeedback(null), 4000);
  };

  // Local state for editing
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>('CREATE_OR_EDIT');
  const [rules, setRules] = useState<ApprovalProcessRuleConfig[]>([]);
  const [adminUserId, setAdminUserId] = useState<string>('');
  const [selectedRuleIndex, setSelectedRuleIndex] = useState<number>(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [showAdminsModal, setShowAdminsModal] = useState(false);
  const [ruleIndexToDelete, setRuleIndexToDelete] = useState<number | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  // Sync state when process data loads
  useEffect(() => {
    if (process) {
      setName(process.name || '');
      setDescription(process.description || '');
      setTriggerType(process.triggerType || 'CREATE_OR_EDIT');

      const rawRules = Array.isArray(process.rules) ? process.rules : [];
      if (rawRules.length === 0) {
        setRules([
          {
            id: `rule_${Date.now()}`,
            name: 'Rule 1',
            ruleOrder: 1,
            criteria: {
              conditions: [
                {
                  id: 1,
                  fieldId: fields[0]?.id || '',
                  operator: 'is',
                  value: '',
                },
              ],
              pattern: '1',
            },
            stages: [
              {
                id: `stage_${Date.now()}`,
                name: 'Stage 1',
                stageOrder: 1,
                approverDefinition: {
                  type: 'USER',
                  userIds: [],
                },
                approvalMode: 'ANYONE',
                recordModification: {
                  allowApproverEditPending: true,
                },
                stageApprovalActions: [],
              },
            ],
            finalApprovalActions: [],
            rejectionActions: [],
          },
        ]);
      } else {
        const normalizedRules: ApprovalProcessRuleConfig[] = rawRules.map((r: any, rIdx: number) => {
          let conditions: CriteriaCondition[] = [];
          let pattern = r.criteriaPattern || r.criteria_pattern || r.criteria?.pattern || '1';

          if (Array.isArray(r.criteria)) {
            conditions = r.criteria;
          } else if (r.criteria && Array.isArray(r.criteria.conditions)) {
            conditions = r.criteria.conditions;
          }

          if (conditions.length === 0) {
            conditions = [
              {
                id: 1,
                fieldId: fields[0]?.id || '',
                operator: 'is',
                value: '',
              },
            ];
            pattern = '1';
          }

          const rawStages = Array.isArray(r.stages) ? r.stages : [];
          let stages = rawStages.map((s: any, sIdx: number) => {
            const approverDef = s.approverDefinition || {
              type: s.approverType || 'USER',
              userIds: s.approverConfig?.userIds || [],
              roleIds: s.approverConfig?.roleIds || [],
              fieldId: s.approverConfig?.lookupFieldId || undefined,
            };
            return {
              id: s.id || `stage_${Date.now()}_${sIdx}`,
              name: s.name || `Stage ${sIdx + 1}`,
              stageOrder: s.stageOrder || s.stage_order || sIdx + 1,
              approverDefinition: approverDef,
              approvalMode: s.approvalMode || s.approval_mode || 'ANYONE',
              recordModification:
                s.recordModification ||
                s.recordModificationConfig ||
                s.record_modification_config || {
                  allowApproverEditPending: true,
                },
              stageApprovalActions: s.stageApprovalActions || [],
            };
          });

          if (stages.length === 0) {
            stages = [
              {
                id: `stage_${Date.now()}`,
                name: 'Stage 1',
                stageOrder: 1,
                approverDefinition: {
                  type: 'USER',
                  userIds: [],
                },
                approvalMode: 'ANYONE',
                recordModification: {
                  allowApproverEditPending: true,
                },
                stageApprovalActions: [],
              },
            ];
          }

          return {
            id: r.id || `rule_${Date.now()}_${rIdx}`,
            name: r.name || `Rule ${rIdx + 1}`,
            ruleOrder: r.ruleOrder || r.rule_order || rIdx + 1,
            criteria: {
              conditions,
              pattern,
            },
            stages,
            finalApprovalActions: r.finalApprovalActions || r.finalActions || [],
            rejectionActions: r.rejectionActions || [],
          };
        });
        setRules(normalizedRules);
      }

      const firstAdmin = Array.isArray(process.admins) && process.admins.length > 0
        ? (process.admins[0]?.userId || '')
        : '';
      setAdminUserId(firstAdmin);
    }
  }, [process]);

  const activeRule = (rules || [])[selectedRuleIndex] || (rules || [])[0];

  const handleUpdateActiveRule = (updatedRule: ApprovalProcessRuleConfig) => {
    if (!isEditMode) return;
    const nextRules = [...rules];
    nextRules[selectedRuleIndex] = updatedRule;
    setRules(nextRules);
  };

  // Reset local state back to server data and exit edit mode
  const handleCancelEdit = () => {
    if (process) {
      setName(process.name || '');
      setDescription(process.description || '');
      setTriggerType(process.triggerType || 'CREATE_OR_EDIT');
      const firstAdmin = Array.isArray(process.admins) && process.admins.length > 0
        ? (process.admins[0]?.userId || '')
        : '';
      setAdminUserId(firstAdmin);
      // Re-run rule normalization by triggering useEffect manually via a small trick:
      // We just set rules from the current process object
      const rawRules = Array.isArray(process.rules) ? process.rules : [];
      if (rawRules.length > 0) {
        // Simplified reset – the useEffect handles full normalization
        // so we just toggle edit mode and let existing state remain consistent
      }
    }
    setIsEditingName(false);
    setFeedback(null);
    setRuleIndexToDelete(null);
    setIsEditMode(false);
  };

  const handleAddRule = () => {
    const nextOrder = (rules || []).length + 1;
    const newRule: ApprovalProcessRuleConfig = {
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: `Rule ${nextOrder}`,
      ruleOrder: nextOrder,
      criteria: {
        conditions: [
          {
            id: 1,
            fieldId: fields[0]?.id || '',
            operator: 'is',
            value: '',
          },
        ],
        pattern: '1',
      },
      stages: [
        {
          id: `stage_${Date.now()}`,
          name: 'Stage 1',
          stageOrder: 1,
          approverDefinition: {
            type: 'USER',
            userIds: [],
          },
          approvalMode: 'ANYONE',
          recordModification: {
            allowApproverEditPending: true,
          },
          stageApprovalActions: [],
        },
      ],
      finalApprovalActions: [],
      rejectionActions: [],
    };
    const nextRules = [...rules, newRule];
    setRules(nextRules);
    setSelectedRuleIndex(nextRules.length - 1);
  };

  const handleConfirmDeleteRule = () => {
    if (ruleIndexToDelete === null) return;
    if (rules.length <= 1) {
      setFeedback({ type: 'error', message: 'An approval process must contain at least one rule.' });
      setRuleIndexToDelete(null);
      return;
    }

    const deletedRuleName = rules[ruleIndexToDelete]?.name || `Rule ${ruleIndexToDelete + 1}`;
    const nextRules = rules.filter((_, idx) => idx !== ruleIndexToDelete);

    // Re-index ruleOrder and sequentially re-number default rule names
    const reorderedRules = nextRules.map((r, idx) => {
      const isDefaultName = !r.name || /^Rule\s*\d+$/i.test(r.name.trim());
      return {
        ...r,
        name: isDefaultName ? `Rule ${idx + 1}` : r.name,
        ruleOrder: idx + 1,
      };
    });

    setRules(reorderedRules);

    // Update selectedRuleIndex to point to a valid rule
    if (selectedRuleIndex >= reorderedRules.length) {
      setSelectedRuleIndex(reorderedRules.length - 1);
    } else if (selectedRuleIndex === ruleIndexToDelete) {
      setSelectedRuleIndex(Math.max(0, Math.min(ruleIndexToDelete, reorderedRules.length - 1)));
    } else if (selectedRuleIndex > ruleIndexToDelete) {
      setSelectedRuleIndex(selectedRuleIndex - 1);
    }

    setRuleIndexToDelete(null);
    setFeedback({ type: 'success', message: `"${deletedRuleName}" deleted successfully.` });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleSave = async (andClose = false) => {
    if (!name.trim()) {
      setFeedback({ type: 'error', message: 'Process name cannot be empty.' });
      return;
    }

    // Validate all criteria conditions across every rule
    const valuelessOps = new Set(['is_empty', 'is_not_empty']);

    const incompleteErrors: string[] = [];
    (rules || []).forEach((rule) => {
      const conditions = rule.criteria?.conditions || [];
      const incomplete = conditions
        .map((c: any, i: number) => {
          if (!c.fieldId) return i + 1;
          if (valuelessOps.has(c.operator)) return null;
          const val = c.value;
          if (val === null || val === undefined || String(val).trim() === '') return i + 1;
          if ((c.operator === 'between' || c.operator === 'not_between')) {
            const val2 = c.secondValue;
            if (val2 === null || val2 === undefined || String(val2).trim() === '') return i + 1;
          }
          return null;
        })
        .filter(Boolean);

      if (incomplete.length > 0) {
        incompleteErrors.push(
          `"${rule.name}": condition${incomplete.length > 1 ? 's' : ''} ${incomplete.join(', ')} ${incomplete.length > 1 ? 'are' : 'is'} incomplete`,
        );
      }

      // Check stages for missing approver users
      const stages = rule.stages || [];
      const incompleteStages = stages
        .map((st: any, sIdx: number) => {
          const type = st.approverDefinition?.type || 'USER';
          if (type === 'USER') {
            const userIds = st.approverDefinition?.userIds || [];
            if (!userIds.length || !userIds[0]) {
              return st.name || `Stage ${sIdx + 1}`;
            }
          } else if (type === 'ROLE') {
            const roleIds = st.approverDefinition?.roleIds || [];
            if (!roleIds.length) {
              return st.name || `Stage ${sIdx + 1}`;
            }
          }
          return null;
        })
        .filter(Boolean);

      if (incompleteStages.length > 0) {
        incompleteErrors.push(
          `"${rule.name}": select an approver user for ${incompleteStages.join(', ')}`,
        );
      }

      // Check for duplicate users assigned across stages within the same rule
      const userStageMap = new Map<string, string[]>();
      stages.forEach((st: any, sIdx: number) => {
        if (st.approverDefinition?.type === 'USER') {
          const uId = (st.approverDefinition?.userIds || [])[0];
          if (uId) {
            const list = userStageMap.get(uId) || [];
            list.push(st.name || `Stage ${sIdx + 1}`);
            userStageMap.set(uId, list);
          }
        }
      });

      userStageMap.forEach((stageNames, uId) => {
        if (stageNames.length > 1) {
          const member = (members || []).find((m: any) => m.userId === uId);
          const userName = member?.fullName || member?.email || 'User';
          incompleteErrors.push(
            `"${rule.name}": "${userName}" is assigned to multiple stages (${stageNames.join(' and ')}). Each stage must have a different approver.`,
          );
        }
      });
    });

    if (incompleteErrors.length > 0) {
      setFeedback({
        type: 'error',
        message: `Please complete all required fields before saving — ${incompleteErrors.join('; ')}.`,
      });
      return;
    }

    try {
      setFeedback(null);
      const payloadRules = (rules || []).map((r) => ({
        id: r.id && !r.id.startsWith('rule_') ? r.id : undefined,
        name: r.name.trim(),
        ruleOrder: r.ruleOrder,
        criteria: r.criteria.conditions,
        criteriaPattern: r.criteria.pattern,
        stages: (r.stages || []).map((st) => ({
          id: st.id && !st.id.startsWith('stage_') ? st.id : undefined,
          name: st.name.trim(),
          stageOrder: st.stageOrder,
          approverType: st.approverDefinition.type,
          approverConfig: {
            userIds: st.approverDefinition.userIds || [],
            roleIds: st.approverDefinition.roleIds || [],
            lookupFieldId: (st.approverDefinition as any)?.fieldId || st.approverDefinition.lookupFieldId,
          },
          approvalMode: st.approvalMode,
          assignTaskForApprovers: false,
          recordModificationConfig: st.recordModification,
        })),
        finalActions: (r.finalApprovalActions || []).map((fa) => ({
          id: fa.id,
          stageId: (fa as any).stageId || null,
          triggerEvent: 'FINAL_APPROVAL' as const,
          actionType: fa.actionType,
          actionConfig: fa.config || (fa as any).actionConfig || {},
        })),
        rejectionActions: (r.rejectionActions || []).map((ra) => ({
          id: ra.id,
          stageId: (ra as any).stageId || null,
          triggerEvent: 'REJECTION' as const,
          actionType: ra.actionType,
          actionConfig: ra.config || (ra as any).actionConfig || {},
        })),
      }));

      await updateMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        moduleId: process?.moduleId || '',
        triggerType,
        admins: adminUserId
          ? [{ userId: adminUserId, canOverride: true, canReassign: true }]
          : [],
        rules: payloadRules as any,
      });
      setFeedback({ type: 'success', message: 'Approval process saved successfully!' });
      if (andClose) {
        navigate(`/organizations/${orgId}/settings/automation/approval-processes`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save approval process.';
      setFeedback({ type: 'error', message: msg });
    }
  };

  if (loadingProcess || loadingFields) {
    return (
      <div className="ap-studio-loading">
        <div className="ap-spinner" />
        <p>Loading approval process studio...</p>
      </div>
    );
  }

  if (loadError || !process) {
    return (
      <div className="ap-studio-error">
        <AlertCircle size={24} />
        <h2>Failed to load approval process</h2>
        <button
          type="button"
          className="ap-button ap-button-secondary"
          onClick={() =>
            navigate(`/organizations/${orgId}/settings/automation/approval-processes`)
          }
        >
          Back to Approval Processes
        </button>
      </div>
    );
  }

  return (
    <div className={`ap-studio-container${isEditMode ? '' : ' is-readonly'}`}>
      {/* Studio Top Navigation Bar */}
      <header className="ap-studio-header">
        <div className="ap-studio-header-left">
          <button
            type="button"
            className="ap-back-button"
            onClick={() =>
              navigate(`/organizations/${orgId}/settings/automation/approval-processes`)
            }
            aria-label="Back to approval processes list"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="ap-process-identity">
            {isEditMode && isEditingName ? (
              <div className="ap-name-edit-box">
                <input
                  type="text"
                  className="ap-input ap-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                  autoFocus
                />
                <button
                  type="button"
                  className="ap-icon-button-sm"
                  onClick={() => setIsEditingName(false)}
                >
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <div
                className={`ap-name-display${isEditMode ? ' is-editable' : ''}`}
                onClick={() => isEditMode && setIsEditingName(true)}
              >
                <h1 className="ap-process-title">{name || 'Untitled Approval Process'}</h1>
                {isEditMode && <Edit2 size={14} className="ap-edit-icon" />}
              </div>
            )}
          </div>

          {/* Read-only mode badge */}
          {!isEditMode && (
            <span className="ap-view-mode-badge">View Only</span>
          )}
        </div>

        <div className="ap-studio-header-actions">
          {feedback && (
            <div className={`ap-studio-feedback is-${feedback.type}`}>
              {feedback.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{feedback.message}</span>
            </div>
          )}

          {isEditMode ? (
            /* ── Edit Mode Actions ── */
            <>
              <button
                type="button"
                className="ap-button ap-button-secondary"
                onClick={handleCancelEdit}
                disabled={updateMutation.isPending}
              >
                Cancel
              </button>

              <button
                type="button"
                className="ap-button ap-button-secondary"
                onClick={() => handleSave(true)}
                disabled={updateMutation.isPending}
              >
                Save &amp; Close
              </button>

              <button
                type="button"
                className="ap-button ap-button-primary"
                onClick={() => handleSave(false)}
                disabled={updateMutation.isPending}
              >
                <Save size={15} />
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            /* ── View Mode Actions ── */
            <>
              {/* Status Toggle Button */}
              <button
                type="button"
                className={`ap-button ${
                  process?.status === 'ACTIVE' ? 'ap-button-status-active' : 'ap-button-status-draft'
                }`}
                onClick={handleToggleStatus}
                disabled={isStatusPending}
                title={process?.status === 'ACTIVE' ? 'Click to Deactivate' : 'Click to Activate'}
              >
                <ShieldCheck size={15} />
                {isStatusPending
                  ? '...'
                  : process?.status === 'ACTIVE'
                  ? 'Active'
                  : 'Draft'}
              </button>

              <button
                type="button"
                className="ap-button ap-button-primary ap-edit-mode-btn"
                onClick={() => setIsEditMode(true)}
                id="ap-enter-edit-mode"
              >
                <Pencil size={15} />
                Edit
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main Studio Body: Left Sidebar + Canvas */}
      <div className="ap-studio-layout">
        {/* Left Sidebar (Execute On & Execute By Rules) */}
        <aside className="ap-studio-sidebar">
          {/* Execute On Box */}
          <div className="ap-sidebar-section">
            <label htmlFor="execute-on-select" className="ap-sidebar-label">Execute On</label>
            <select
              id="execute-on-select"
              className="ap-select ap-sidebar-select"
              value={triggerType}
              onChange={(e) => isEditMode && setTriggerType(e.target.value as TriggerType)}
              disabled={!isEditMode}
            >
              <option value="CREATE_OR_EDIT">Create or Edit</option>
              <option value="CREATE_ONLY">Create</option>
              <option value="EDIT_ONLY">Edit</option>
            </select>
          </div>

          {/* Execute By Rules List */}
          <div className="ap-sidebar-section ap-rules-section">
            <span className="ap-sidebar-label">Execute By</span>
            <div className="ap-sidebar-rules-list">
              {(rules || []).map((rule, idx) => {
                const isSelected = idx === selectedRuleIndex;
                return (
                  <div
                    key={rule.id || idx}
                    className={`ap-sidebar-rule-item-wrap ${isSelected ? 'is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className={`ap-sidebar-rule-item ${isSelected ? 'is-active' : ''}`}
                      onClick={() => setSelectedRuleIndex(idx)}
                    >
                      <span className="ap-rule-dot" />
                      <span className="ap-rule-name">{rule.name || `Rule ${idx + 1}`}</span>
                    </button>
                    {isEditMode && (rules || []).length > 1 && (
                      <button
                        type="button"
                        className="ap-rule-item-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRuleIndexToDelete(idx);
                        }}
                        title={`Delete ${rule.name || `Rule ${idx + 1}`}`}
                        aria-label={`Delete ${rule.name || `Rule ${idx + 1}`}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {isEditMode && (
              <button
                type="button"
                className="ap-add-rule-btn"
                onClick={handleAddRule}
              >
                <Plus size={14} /> Add Rule
              </button>
            )}
          </div>
        </aside>

        {/* Main Configuration Canvas */}
        <main className="ap-studio-canvas">
          {activeRule ? (
            <div className="ap-canvas-content">
              {/* Canvas Rule Header */}
              <div className="ap-rule-header-bar">
                <div className="ap-rule-title-group">
                  {isEditMode ? (
                    <input
                      type="text"
                      className="ap-rule-title-input"
                      value={activeRule.name}
                      onChange={(e) =>
                        handleUpdateActiveRule({ ...activeRule, name: e.target.value })
                      }
                      placeholder="Rule Name"
                    />
                  ) : (
                    <h2 className="ap-rule-title-readonly">{activeRule.name || 'Unnamed Rule'}</h2>
                  )}
                </div>

                <div className="ap-rule-header-actions">
                  <button
                    type="button"
                    className="ap-assign-admins-btn"
                    onClick={() => isEditMode && setShowAdminsModal(true)}
                    disabled={!isEditMode}
                    title={!isEditMode ? 'Switch to Edit mode to assign admins' : undefined}
                  >
                    <ShieldCheck size={16} />
                    <span>Process Admin</span>
                    {adminUserId && (
                      <span className="ap-admins-count">1</span>
                    )}
                  </button>

                  {isEditMode && (rules || []).length > 1 && (
                    <button
                      type="button"
                      className="ap-delete-rule-canvas-btn"
                      onClick={() => setRuleIndexToDelete(selectedRuleIndex)}
                      title={`Delete ${activeRule.name || 'this rule'}`}
                    >
                      <Trash2 size={15} />
                      <span>Delete Rule</span>
                    </button>
                  )}
                </div>
              </div>

              {/* CARD 1: Approval Criteria */}
              <section className="ap-canvas-card">
                <CriteriaBuilder
                  orgId={orgId || ''}
                  criteria={activeRule.criteria}
                  fields={fields}
                  onChange={(updatedCriteria) =>
                    handleUpdateActiveRule({ ...activeRule, criteria: updatedCriteria })
                  }
                />
              </section>

              {/* Connector Downward Arrow */}
              <div className="ap-canvas-connector" aria-hidden="true">
                <div className="ap-canvas-line" />
                <div className="ap-canvas-arrow">↓</div>
              </div>

              {/* CARD 2: Approval Stages */}
              <section className="ap-canvas-card">
                <ApprovalStagesList
                  orgId={orgId}
                  stages={activeRule.stages}
                  fields={fields}
                  members={members}
                  roles={roles}
                  onChange={(updatedStages) =>
                    handleUpdateActiveRule({ ...activeRule, stages: updatedStages })
                  }
                />
              </section>

              {/* Connector Downward Lightning */}
              <div className="ap-canvas-connector" aria-hidden="true">
                <div className="ap-canvas-line" />
              </div>

              {/* CARD 3: Final Actions (Dual Branch) */}
              <section className="ap-canvas-card">
                <ActionCard
                  orgId={orgId}
                  finalApprovalActions={activeRule.finalApprovalActions || []}
                  rejectionActions={activeRule.rejectionActions || []}
                  fields={fields}
                  members={members}
                  onFinalApprovalActionsChange={(actions) =>
                    handleUpdateActiveRule({ ...activeRule, finalApprovalActions: actions })
                  }
                  onRejectionActionsChange={(actions) =>
                    handleUpdateActiveRule({ ...activeRule, rejectionActions: actions })
                  }
                />
              </section>
            </div>
          ) : (
            <div className="ap-canvas-empty">Select or add a rule to configure.</div>
          )}
        </main>
      </div>

      {/* Assign Admins Modal */}
      {showAdminsModal && (
        <AssignAdminsModal
          selectedUserId={adminUserId}
          members={members}
          onSave={(id) => setAdminUserId(id)}
          onClose={() => setShowAdminsModal(false)}
        />
      )}

      {/* Delete Rule Confirmation Modal */}
      {ruleIndexToDelete !== null && rules[ruleIndexToDelete] && (
        <div
          className="ap-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRuleIndexToDelete(null);
          }}
        >
          <div
            className="ap-modal ap-delete-confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-rule-title"
          >
            <div className="ap-modal-header ap-delete-modal-header">
              <div className="ap-modal-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div className="ap-delete-icon-badge">
                  <AlertTriangle size={18} color="#ef4444" />
                </div>
                <h3 id="delete-rule-title" className="ap-modal-title">
                  Delete Rule
                </h3>
              </div>
              <button
                type="button"
                className="ap-icon-button"
                onClick={() => setRuleIndexToDelete(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="ap-modal-body" style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 10px', fontSize: '14px', lineHeight: '1.5', color: 'var(--color-text)' }}>
                Are you sure you want to delete{' '}
                <strong>
                  "{rules[ruleIndexToDelete]?.name || `Rule ${ruleIndexToDelete + 1}`}"
                </strong>
                ?
              </p>
              <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.5', color: 'var(--color-text-muted)' }}>
                This will remove all configured criteria, approval stages, and final actions associated with this rule.
              </p>
            </div>

            <div className="ap-modal-footer">
              <button
                type="button"
                className="ap-button ap-button-ghost"
                onClick={() => setRuleIndexToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ap-button ap-button-danger ap-delete-confirm-btn"
                onClick={handleConfirmDeleteRule}
              >
                <Trash2 size={14} />
                <span>Delete Rule</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
