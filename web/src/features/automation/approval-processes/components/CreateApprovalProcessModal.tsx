import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '../../../../components/ui/Modal';
import { useApprovalModules, useCreateApprovalProcess, useActivateApprovalProcess } from '../api/approvalProcess.api';
import type { TriggerType, ModuleMetadata } from '../types/approvalProcess.types';
import './CreateApprovalProcessModal.css';

interface CreateApprovalProcessModalProps {
  orgId: string;
  initialModuleId?: string;
  onClose: () => void;
}

export function CreateApprovalProcessModal({
  orgId,
  initialModuleId,
  onClose,
}: CreateApprovalProcessModalProps) {
  const navigate = useNavigate();
  const { data: rawModules, isLoading: loadingModules } = useApprovalModules(orgId);
  const modules: ModuleMetadata[] = Array.isArray(rawModules)
    ? rawModules
    : Array.isArray((rawModules as any)?.modules)
    ? (rawModules as any).modules
    : [];
  const createMutation = useCreateApprovalProcess(orgId);
  const activateMutation = useActivateApprovalProcess(orgId);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [moduleId, setModuleId] = useState(initialModuleId || '');
  const [triggerType, setTriggerType] = useState<TriggerType>('CREATE_OR_EDIT');
  const [activateImmediately, setActivateImmediately] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Preselect initial module if passed
  useEffect(() => {
    if (initialModuleId && !moduleId) {
      setModuleId(initialModuleId);
    }
  }, [initialModuleId, moduleId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Please enter a process name.');
      return;
    }
    if (!moduleId) {
      setErrorMessage('Please select a module.');
      return;
    }

    try {
      setErrorMessage(null);
      const created = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        moduleId,
        triggerType,
      });

      // Attempt to activate immediately if requested.
      // This will fail if the new process has no configured approver stages —
      // in that case we navigate to the studio with a hash flag so the studio
      // can surface a helpful feedback message.
      let activationFailed = false;
      if (activateImmediately) {
        try {
          await activateMutation.mutateAsync(created.id);
        } catch {
          activationFailed = true;
        }
      }

      onClose();
      navigate(
        `/organizations/${orgId}/settings/automation/approval-processes/${created.id}/edit${
          activateImmediately && !activationFailed ? '' : activationFailed ? '#needs-activation' : ''
        }`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create approval process.';
      setErrorMessage(msg);
    }
  };

  const footer = (
    <div className="cap-modal-footer-actions">
      <button
        type="button"
        className="cap-btn cap-btn-secondary"
        onClick={onClose}
        disabled={createMutation.isPending || activateMutation.isPending}
      >
        Cancel
      </button>
      <button
        type="submit"
        form="create-approval-process-form"
        className="cap-btn cap-btn-primary"
        disabled={createMutation.isPending || activateMutation.isPending || !name.trim() || !moduleId}
      >
        {createMutation.isPending ? (
          <>
            <Loader2 size={15} className="cap-spinner" />
            <span>Creating...</span>
          </>
        ) : activateMutation.isPending ? (
          <>
            <Loader2 size={15} className="cap-spinner" />
            <span>Activating...</span>
          </>
        ) : (
          'Next'
        )}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={true}
      title="Create Approval Process"
      subtitle="Specify the module and trigger conditions for this approval process"
      onClose={onClose}
      width={560}
      footer={footer}
    >
      <form id="create-approval-process-form" onSubmit={handleSubmit} className="cap-modal-form" noValidate>
        {errorMessage && (
          <div className="cap-alert-error" role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="cap-form-group">
          <label htmlFor="process-name" className="cap-label">
            Name <span className="cap-req-star">*</span>
          </label>
          <input
            id="process-name"
            type="text"
            className="cap-input"
            placeholder="e.g., High Value Purchase Approval"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            autoFocus
          />
        </div>

        <div className="cap-form-group">
          <label htmlFor="process-description" className="cap-label">
            Description
          </label>
          <textarea
            id="process-description"
            className="cap-textarea"
            rows={3}
            placeholder="Explain the purpose and business logic of this approval process..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="cap-form-group">
          <label htmlFor="process-module" className="cap-label">
            Module <span className="cap-req-star">*</span>
          </label>
          <select
            id="process-module"
            className="cap-select"
            value={moduleId}
            onChange={(e) => setModuleId(e.target.value)}
            disabled={loadingModules}
            required
          >
            <option value="">Select a Module...</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="cap-form-group">
          <label className="cap-label">
            Send for Approval on <span className="cap-req-star">*</span>
          </label>
          <p className="cap-field-hint">Specify when a record will be sent for approval</p>
          <div className="cap-trigger-radios" role="radiogroup" aria-label="Send for Approval on">
            <label className={`cap-radio-card ${triggerType === 'CREATE_ONLY' ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="triggerType"
                value="CREATE_ONLY"
                checked={triggerType === 'CREATE_ONLY'}
                onChange={() => setTriggerType('CREATE_ONLY')}
              />
              <div className="cap-radio-indicator">
                <div className="cap-radio-dot" />
              </div>
              <div className="cap-radio-content">
                <span className="cap-radio-title">Create</span>
                <span className="cap-radio-desc">Trigger only when a new record is created</span>
              </div>
            </label>

            <label className={`cap-radio-card ${triggerType === 'EDIT_ONLY' ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="triggerType"
                value="EDIT_ONLY"
                checked={triggerType === 'EDIT_ONLY'}
                onChange={() => setTriggerType('EDIT_ONLY')}
              />
              <div className="cap-radio-indicator">
                <div className="cap-radio-dot" />
              </div>
              <div className="cap-radio-content">
                <span className="cap-radio-title">Edit</span>
                <span className="cap-radio-desc">Trigger only when an existing record is edited</span>
              </div>
            </label>

            <label className={`cap-radio-card ${triggerType === 'CREATE_OR_EDIT' ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="triggerType"
                value="CREATE_OR_EDIT"
                checked={triggerType === 'CREATE_OR_EDIT'}
                onChange={() => setTriggerType('CREATE_OR_EDIT')}
              />
              <div className="cap-radio-indicator">
                <div className="cap-radio-dot" />
              </div>
              <div className="cap-radio-content">
                <span className="cap-radio-title">Create or Edit</span>
                <span className="cap-radio-desc">Trigger on both creation and subsequent updates</span>
              </div>
            </label>
          </div>
        </div>

        {/* Activate immediately option */}
        <div className="cap-form-group" style={{ marginTop: 4 }}>
          <label
            htmlFor="activate-immediately"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              cursor: 'pointer',
              padding: '12px 14px',
              borderRadius: 8,
              border: `1px solid ${activateImmediately ? '#2563eb' : '#e2e8f0'}`,
              background: activateImmediately ? '#eff6ff' : '#f8fafc',
              transition: 'all 0.15s ease',
            }}
          >
            <input
              id="activate-immediately"
              type="checkbox"
              checked={activateImmediately}
              onChange={(e) => setActivateImmediately(e.target.checked)}
              style={{ marginTop: 2, accentColor: '#2563eb', cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>
                Activate this process immediately
              </div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
                Process will start triggering on new records as soon as it is created.
                You can always activate it later after configuring rules and approver stages.
              </div>
            </div>
          </label>
        </div>
      </form>
    </Modal>
  );
}
