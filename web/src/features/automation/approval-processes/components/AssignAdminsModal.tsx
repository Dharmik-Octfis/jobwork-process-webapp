import { useState } from 'react';
import { X, ShieldCheck, Search, Check, UserX, User } from 'lucide-react';
import type { Member } from '../../../members/members.api';

interface AssignAdminsModalProps {
  selectedUserId: string;
  members: Member[];
  onSave: (userId: string) => void;
  onClose: () => void;
}

function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.trim()) {
    return email.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export function AssignAdminsModal({
  selectedUserId,
  members,
  onSave,
  onClose,
}: AssignAdminsModalProps) {
  const [selected, setSelected] = useState<string>(selectedUserId || '');
  const [searchTerm, setSearchTerm] = useState('');

  // Active members only
  const activeMembers = (Array.isArray(members) ? members : []).filter(
    (m) => (m as any).status !== 'inactive' && (m as any).isActive !== false,
  );

  const filteredMembers = activeMembers.filter((m) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      (m.fullName || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q) ||
      (m.roleName || '').toLowerCase().includes(q)
    );
  });

  const handleSave = () => {
    onSave(selected);
    onClose();
  };

  const selectedMember = activeMembers.find((m) => m.userId === selected);

  return (
    <div
      className="ap-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ap-modal ap-admins-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admins-title"
      >
        {/* Header */}
        <div className="ap-modal-header">
          <div className="ap-modal-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="ap-admin-icon-badge">
              <ShieldCheck size={18} color="var(--color-primary)" />
            </div>
            <h3 id="admins-title" className="ap-modal-title">
              Assign Process Admin
            </h3>
          </div>
          <button type="button" className="ap-icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="ap-modal-body">
          <div className="ap-admin-info-banner">
            <p className="ap-modal-intro" style={{ margin: 0, fontSize: '13px', lineHeight: '1.45' }}>
              The Process Admin has elevated authority to approve or reject pending requests at any
              stage, and can reassign approvers in urgent situations.
            </p>
          </div>

          <div className="ap-form-group">
            <label className="ap-label" htmlFor="ap-admin-search">
              Search &amp; Select User
            </label>

            {/* Search Input */}
            <div className="ap-admin-search-wrap">
              <Search size={15} className="ap-admin-search-icon" />
              <input
                id="ap-admin-search"
                type="text"
                className="ap-input ap-admin-search-input"
                placeholder="Search users by name, email, or role..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoComplete="off"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="ap-admin-search-clear"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Members Selection List */}
            <div className="ap-admin-users-list" role="listbox" aria-label="Users list">
              {/* Option: No Admin */}
              {(!searchTerm || 'no admin assigned'.includes(searchTerm.toLowerCase())) && (
                <div
                  className={`ap-admin-user-card ${selected === '' ? 'is-selected' : ''}`}
                  onClick={() => setSelected('')}
                  role="option"
                  aria-selected={selected === ''}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected('');
                    }
                  }}
                >
                  <div className="ap-admin-avatar ap-avatar-none">
                    <UserX size={16} />
                  </div>
                  <div className="ap-admin-user-info">
                    <div className="ap-admin-user-name">No Process Admin</div>
                    <div className="ap-admin-user-sub">
                      Approvals follow stage rules without a designated admin
                    </div>
                  </div>
                  <div className="ap-admin-select-check">
                    {selected === '' && <Check size={16} className="ap-check-icon" />}
                  </div>
                </div>
              )}

              {/* Filtered Active Members */}
              {filteredMembers.map((m) => {
                const isSelected = selected === m.userId;
                return (
                  <div
                    key={m.userId}
                    className={`ap-admin-user-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => setSelected(m.userId)}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(m.userId);
                      }
                    }}
                  >
                    <div className="ap-admin-avatar">
                      {getInitials(m.fullName, m.email)}
                    </div>
                    <div className="ap-admin-user-info">
                      <div className="ap-admin-user-header">
                        <span className="ap-admin-user-name">{m.fullName || m.email}</span>
                        {m.roleName && (
                          <span className="ap-admin-role-badge">{m.roleName}</span>
                        )}
                      </div>
                      <div className="ap-admin-user-sub">{m.email}</div>
                    </div>
                    <div className="ap-admin-select-check">
                      {isSelected && <Check size={16} className="ap-check-icon" />}
                    </div>
                  </div>
                );
              })}

              {filteredMembers.length === 0 && searchTerm && (
                <div className="ap-admin-empty-state">
                  <User size={24} className="ap-empty-icon" />
                  <p>No members found matching &quot;{searchTerm}&quot;</p>
                </div>
              )}
            </div>
          </div>

          {/* Current Selection Feedback */}
          <div className="ap-selected-admin-preview">
            <ShieldCheck size={16} />
            <span>
              {selectedMember ? (
                <>
                  Assigned Admin: <strong>{selectedMember.fullName || selectedMember.email}</strong>
                  {selectedMember.roleName ? ` (${selectedMember.roleName})` : ''}
                </>
              ) : (
                'No Process Admin will be assigned'
              )}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="ap-modal-footer">
          <button type="button" className="ap-button ap-button-ghost" onClick={onClose}>
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
