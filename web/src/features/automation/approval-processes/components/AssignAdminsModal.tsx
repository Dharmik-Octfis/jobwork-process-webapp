import { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import type { Member } from '../../../members/members.api';

interface AssignAdminsModalProps {
  selectedUserId: string;
  members: Member[];
  onSave: (userId: string) => void;
  onClose: () => void;
}

export function AssignAdminsModal({
  selectedUserId,
  members,
  onSave,
  onClose,
}: AssignAdminsModalProps) {
  const [selected, setSelected] = useState<string>(selectedUserId || '');
  const [searchTerm, setSearchTerm] = useState('');

  const safeMembers = Array.isArray(members) ? members : [];
  const filteredMembers = safeMembers.filter(
    (m) =>
      (m.fullName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleSave = () => {
    onSave(selected);
    onClose();
  };

  const selectedMember = safeMembers.find((m) => m.userId === selected);

  return (
    <div
      className="ap-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ap-modal ap-admins-modal" role="dialog" aria-modal="true" aria-labelledby="admins-title">
        <div className="ap-modal-header">
          <div className="ap-modal-title-wrap">
            <ShieldCheck size={20} className="ap-admin-icon" />
            <h3 id="admins-title" className="ap-modal-title">
              Assign Process Admin
            </h3>
          </div>
          <button type="button" className="ap-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="ap-modal-body">
          <p className="ap-modal-intro">
            The Process Admin has elevated authority to approve or reject pending requests at any
            stage, and can reassign approvers in urgent situations.
          </p>

          <div className="ap-form-group">
            <label className="ap-label" htmlFor="ap-admin-search">
              Search &amp; Select User
            </label>
            <div className="ap-search-wrap" style={{ marginBottom: '12px' }}>
              <input
                id="ap-admin-search"
                type="search"
                className="ap-input"
                placeholder="Search users by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="ap-select"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              size={Math.min(filteredMembers.length + 1, 8)}
              aria-label="Select admin user"
              style={{ width: '100%', minHeight: '120px' }}
            >
              <option value="">— No admin assigned —</option>
              {filteredMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName || m.email}
                  {m.roleName ? ` (${m.roleName})` : ''}
                </option>
              ))}
            </select>

            {filteredMembers.length === 0 && searchTerm && (
              <div className="ap-empty-state-sm">No members found matching &quot;{searchTerm}&quot;</div>
            )}
          </div>

          {selectedMember && (
            <div className="ap-selected-admin-preview">
              <ShieldCheck size={14} />
              <span>
                Selected: <strong>{selectedMember.fullName || selectedMember.email}</strong>
                {selectedMember.roleName ? ` — ${selectedMember.roleName}` : ''}
              </span>
            </div>
          )}
        </div>

        <div className="ap-modal-footer">
          <button type="button" className="ap-button ap-button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ap-button ap-button-primary" onClick={handleSave}>
            Save Admin
          </button>
        </div>
      </div>
    </div>
  );
}
