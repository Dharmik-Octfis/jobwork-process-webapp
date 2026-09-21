import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type {
  ActionType,
  ApprovalActionConfig,
  FieldMetadata,
} from '../types/approvalProcess.types';
import type { Member } from '../../../members/members.api';

interface ActionConfigurationModalProps {
  actionType: ActionType;
  initialAction?: ApprovalActionConfig;
  fields: FieldMetadata[];
  members: Member[];
  onSave: (action: ApprovalActionConfig) => void;
  onClose: () => void;
}

export function ActionConfigurationModal({
  actionType,
  initialAction,
  fields,
  members,
  onSave,
  onClose,
}: ActionConfigurationModalProps) {
  const safeFields = Array.isArray(fields) ? fields : [];
  const safeMembers = Array.isArray(members) ? members : [];

  const [name, setName] = useState(initialAction?.name || getDefaultName(actionType));
  const [fieldId, setFieldId] = useState(
    (initialAction?.config?.fieldId as string) || safeFields[0]?.id || '',
  );
  const [valueType, setValueType] = useState<'static' | 'token'>(
    (initialAction?.config?.valueType as 'static' | 'token') || 'static',
  );
  const [staticValue, setStaticValue] = useState<unknown>(
    initialAction?.config?.value !== undefined ? initialAction.config.value : '',
  );
  const [tokenValue, setTokenValue] = useState<string>(
    (initialAction?.config?.token as string) || '$CURRENT_DATETIME',
  );

  // Task configuration
  const [taskSubject, setTaskSubject] = useState(
    (initialAction?.config?.taskSubject as string) || '',
  );
  const [taskDueDays, setTaskDueDays] = useState(
    Number(initialAction?.config?.taskDueDays || 1),
  );
  const [taskPriority, setTaskPriority] = useState(
    (initialAction?.config?.taskPriority as string) || 'NORMAL',
  );
  const [taskAssignee, setTaskAssignee] = useState(
    (initialAction?.config?.taskAssignee as string) || 'RECORD_OWNER',
  );

  // Email configuration
  const [emailSubject, setEmailSubject] = useState(
    (initialAction?.config?.emailSubject as string) || '',
  );
  const [emailBody, setEmailBody] = useState(
    (initialAction?.config?.emailBody as string) || '',
  );
  const [emailRecipient, setEmailRecipient] = useState(
    (initialAction?.config?.emailRecipient as string) || 'RECORD_OWNER',
  );

  // Webhook configuration
  const [webhookUrl, setWebhookUrl] = useState(
    (initialAction?.config?.webhookUrl as string) || '',
  );
  const [webhookMethod, setWebhookMethod] = useState(
    (initialAction?.config?.webhookMethod as string) || 'POST',
  );

  // Notification configuration
  const [notifTitle, setNotifTitle] = useState(
    (initialAction?.config?.notifTitle as string) || '',
  );
  const [notifMessage, setNotifMessage] = useState(
    (initialAction?.config?.notifMessage as string) || '',
  );

  const [error, setError] = useState<string | null>(null);

  const selectedField = safeFields.find((f) => f.id === fieldId || f.apiName === fieldId);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide an action name.');
      return;
    }

    let config: Record<string, unknown> = {};

    if (actionType === 'UPDATE_FIELDS') {
      if (!fieldId) {
        setError('Please choose a field to update.');
        return;
      }
      config = {
        fieldId,
        fieldName: selectedField?.label,
        valueType,
        value: valueType === 'token' ? tokenValue : staticValue,
        token: valueType === 'token' ? tokenValue : undefined,
      };
    } else if (actionType === 'ASSIGN_TASK') {
      if (!taskSubject.trim()) {
        setError('Please enter a task subject.');
        return;
      }
      config = {
        taskSubject: taskSubject.trim(),
        taskDueDays,
        taskPriority,
        taskAssignee,
      };
    } else if (actionType === 'EMAIL_NOTIFICATION') {
      if (!emailSubject.trim()) {
        setError('Please enter an email subject.');
        return;
      }
      config = {
        emailSubject: emailSubject.trim(),
        emailBody: emailBody.trim(),
        emailRecipient,
      };
    } else if (actionType === 'WEBHOOK') {
      if (!webhookUrl.trim().startsWith('http://') && !webhookUrl.trim().startsWith('https://')) {
        setError('Webhook URL must start with http:// or https://');
        return;
      }
      config = {
        webhookUrl: webhookUrl.trim(),
        webhookMethod,
      };
    } else if (actionType === 'IN_APP_NOTIFICATION') {
      if (!notifTitle.trim()) {
        setError('Please enter a notification title.');
        return;
      }
      config = {
        notifTitle: notifTitle.trim(),
        notifMessage: notifMessage.trim(),
      };
    }

    onSave({
      id: initialAction?.id || `act_${Date.now()}`,
      actionType,
      name: name.trim(),
      config,
    });
    onClose();
  };

  return (
    <div
      className="ap-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ap-modal ap-action-modal" role="dialog" aria-modal="true" aria-labelledby="action-title">
        <div className="ap-modal-header">
          <h3 id="action-title" className="ap-modal-title">
            Configure {getActionTypeLabel(actionType)}
          </h3>
          <button type="button" className="ap-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="ap-modal-form">
          <div className="ap-modal-body">
            {error && (
              <div className="ap-alert ap-alert-error" role="alert">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="ap-form-group">
              <label htmlFor="action-name" className="ap-label required">
                Action Name
              </label>
              <input
                id="action-name"
                type="text"
                className="ap-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Update status to Approved"
                required
              />
            </div>

            {/* UPDATE FIELDS VIEW */}
            {actionType === 'UPDATE_FIELDS' && (
              <>
                <div className="ap-form-group">
                  <label htmlFor="target-field" className="ap-label required">
                    Field to Update
                  </label>
                  <select
                    id="target-field"
                    className="ap-select"
                    value={fieldId}
                    onChange={(e) => setFieldId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select field...
                    </option>
                    {safeFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label} ({f.dataType})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ap-form-group">
                  <label className="ap-label">Value Mode</label>
                  <div className="ap-tab-group">
                    <button
                      type="button"
                      className={`ap-tab-btn ${valueType === 'static' ? 'is-active' : ''}`}
                      onClick={() => setValueType('static')}
                    >
                      Specific Value
                    </button>
                    <button
                      type="button"
                      className={`ap-tab-btn ${valueType === 'token' ? 'is-active' : ''}`}
                      onClick={() => setValueType('token')}
                    >
                      Dynamic Token
                    </button>
                  </div>
                </div>

                {valueType === 'token' ? (
                  <div className="ap-form-group">
                    <label htmlFor="dynamic-token" className="ap-label">
                      Select Token
                    </label>
                    <select
                      id="dynamic-token"
                      className="ap-select"
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                    >
                      <option value="$CURRENT_DATETIME">Current Date & Time</option>
                      <option value="$CURRENT_USER">Current Approver ID</option>
                      <option value="$RECORD_OWNER">Record Owner</option>
                    </select>
                  </div>
                ) : (
                  <div className="ap-form-group">
                    <label htmlFor="static-value" className="ap-label">
                      New Value
                    </label>
                    {Array.isArray(selectedField?.options) && selectedField.options.length > 0 ? (
                      <select
                        id="static-value"
                        className="ap-select"
                        value={(staticValue as string) || ''}
                        onChange={(e) => setStaticValue(e.target.value)}
                      >
                        <option value="">Select option...</option>
                        {selectedField.options.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : selectedField?.dataType === 'boolean' ? (
                      <select
                        id="static-value"
                        className="ap-select"
                        value={String(staticValue)}
                        onChange={(e) => setStaticValue(e.target.value === 'true')}
                      >
                        <option value="true">True / Yes</option>
                        <option value="false">False / No</option>
                      </select>
                    ) : selectedField?.dataType === 'date' ? (
                      <input
                        id="static-value"
                        type="date"
                        className="ap-input"
                        value={(staticValue as string) || ''}
                        onChange={(e) => setStaticValue(e.target.value)}
                      />
                    ) : selectedField?.dataType === 'number' || selectedField?.dataType === 'currency' ? (
                      <input
                        id="static-value"
                        type="number"
                        step="any"
                        className="ap-input"
                        placeholder="0"
                        value={(staticValue as string) || ''}
                        onChange={(e) => setStaticValue(e.target.value)}
                      />
                    ) : (
                      <input
                        id="static-value"
                        type="text"
                        className="ap-input"
                        placeholder="Enter value"
                        value={(staticValue as string) || ''}
                        onChange={(e) => setStaticValue(e.target.value)}
                      />
                    )}
                  </div>
                )}
              </>
            )}

            {/* ASSIGN TASK VIEW */}
            {actionType === 'ASSIGN_TASK' && (
              <>
                <div className="ap-form-group">
                  <label htmlFor="task-subject" className="ap-label required">
                    Task Subject
                  </label>
                  <input
                    id="task-subject"
                    type="text"
                    className="ap-input"
                    value={taskSubject}
                    onChange={(e) => setTaskSubject(e.target.value)}
                    placeholder="e.g. Follow up on purchase order fulfillment"
                    required
                  />
                </div>

                <div className="ap-form-row">
                  <div className="ap-form-group ap-col-6">
                    <label htmlFor="task-due-days" className="ap-label">
                      Due In (Days)
                    </label>
                    <input
                      id="task-due-days"
                      type="number"
                      min={0}
                      className="ap-input"
                      value={taskDueDays}
                      onChange={(e) => setTaskDueDays(Number(e.target.value))}
                    />
                  </div>

                  <div className="ap-form-group ap-col-6">
                    <label htmlFor="task-priority" className="ap-label">
                      Priority
                    </label>
                    <select
                      id="task-priority"
                      className="ap-select"
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value)}
                    >
                      <option value="HIGH">High</option>
                      <option value="NORMAL">Normal</option>
                      <option value="LOW">Low</option>
                    </select>
                  </div>
                </div>

                <div className="ap-form-group">
                  <label htmlFor="task-assignee" className="ap-label">
                    Assign To
                  </label>
                  <select
                    id="task-assignee"
                    className="ap-select"
                    value={taskAssignee}
                    onChange={(e) => setTaskAssignee(e.target.value)}
                  >
                    <option value="RECORD_OWNER">Record Owner</option>
                    <option value="CURRENT_USER">Approver</option>
                    {safeMembers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        User: {m.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {/* EMAIL NOTIFICATION VIEW */}
            {actionType === 'EMAIL_NOTIFICATION' && (
              <>
                <div className="ap-form-group">
                  <label htmlFor="email-subject" className="ap-label required">
                    Subject Line
                  </label>
                  <input
                    id="email-subject"
                    type="text"
                    className="ap-input"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="e.g. Your request has been approved"
                    required
                  />
                </div>

                <div className="ap-form-group">
                  <label htmlFor="email-recipient" className="ap-label">
                    Recipient
                  </label>
                  <select
                    id="email-recipient"
                    className="ap-select"
                    value={emailRecipient}
                    onChange={(e) => setEmailRecipient(e.target.value)}
                  >
                    <option value="RECORD_OWNER">Record Owner</option>
                    <option value="STAGE_APPROVERS">Stage Approvers</option>
                    <option value="ALL_PARTICIPANTS">All Process Participants</option>
                  </select>
                </div>

                <div className="ap-form-group">
                  <label htmlFor="email-body" className="ap-label">
                    Email Content
                  </label>
                  <textarea
                    id="email-body"
                    className="ap-textarea"
                    rows={4}
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Hello,\n\nYour request has been approved..."
                  />
                </div>
              </>
            )}

            {/* WEBHOOK VIEW */}
            {actionType === 'WEBHOOK' && (
              <>
                <div className="ap-form-group">
                  <label htmlFor="webhook-url" className="ap-label required">
                    Webhook Endpoint URL
                  </label>
                  <input
                    id="webhook-url"
                    type="url"
                    className="ap-input"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://api.yourcompany.com/webhook/approvals"
                    required
                  />
                  <p className="ap-field-hint">
                    Safe URL validation is enforced. Internal IPs and loopback addresses are blocked.
                  </p>
                </div>

                <div className="ap-form-group">
                  <label htmlFor="webhook-method" className="ap-label">
                    HTTP Method
                  </label>
                  <select
                    id="webhook-method"
                    className="ap-select"
                    value={webhookMethod}
                    onChange={(e) => setWebhookMethod(e.target.value)}
                  >
                    <option value="POST">POST (JSON payload)</option>
                    <option value="PUT">PUT (JSON payload)</option>
                  </select>
                </div>
              </>
            )}

            {/* IN-APP NOTIFICATION VIEW */}
            {actionType === 'IN_APP_NOTIFICATION' && (
              <>
                <div className="ap-form-group">
                  <label htmlFor="notif-title" className="ap-label required">
                    Notification Title
                  </label>
                  <input
                    id="notif-title"
                    type="text"
                    className="ap-input"
                    value={notifTitle}
                    onChange={(e) => setNotifTitle(e.target.value)}
                    placeholder="Record Approved"
                    required
                  />
                </div>

                <div className="ap-form-group">
                  <label htmlFor="notif-message" className="ap-label">
                    Message
                  </label>
                  <textarea
                    id="notif-message"
                    className="ap-textarea"
                    rows={3}
                    value={notifMessage}
                    onChange={(e) => setNotifMessage(e.target.value)}
                    placeholder="The record has completed approval."
                  />
                </div>
              </>
            )}
          </div>

          <div className="ap-modal-footer">
            <button type="button" className="ap-button ap-button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ap-button ap-button-primary">
              Save Action
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function getDefaultName(type: ActionType): string {
  switch (type) {
    case 'UPDATE_FIELDS':
      return 'Update Record Field';
    case 'ASSIGN_TASK':
      return 'Assign Follow-up Task';
    case 'EMAIL_NOTIFICATION':
      return 'Send Email Alert';
    case 'IN_APP_NOTIFICATION':
      return 'Send In-App Notification';
    case 'WEBHOOK':
      return 'Trigger External Webhook';
    case 'FUNCTION':
      return 'Execute Custom Function';
  }
}

function getActionTypeLabel(type: ActionType): string {
  switch (type) {
    case 'UPDATE_FIELDS':
      return 'Field Update';
    case 'ASSIGN_TASK':
      return 'Task Assignment';
    case 'EMAIL_NOTIFICATION':
      return 'Email Notification';
    case 'IN_APP_NOTIFICATION':
      return 'In-App Notification';
    case 'WEBHOOK':
      return 'Webhook';
    case 'FUNCTION':
      return 'Function';
  }
}
