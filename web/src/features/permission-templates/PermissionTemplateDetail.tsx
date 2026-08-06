import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Edit, Lock, X, Users } from 'lucide-react';
import { permissionTemplatesApi } from './permissionTemplates.api';
import type { PermissionTemplate } from './permissionTemplates.api';
import { membersApi, isMember } from '../members/members.api';

interface Props {
  orgId: string;
  templateId: string;
  onClose: () => void;
  /** Raised to the list, which owns the ConfirmDialog and the delete mutation. */
  onDelete: (template: PermissionTemplate) => void;
}

/**
 * The right-hand pane for one permission profile — the same master/detail shape
 * Vendors and Users use, opened by `?id=` on the list URL.
 *
 * Read-only on purpose. A profile is edited wholesale on its own full-page route:
 * the permission grid is a hundred checkboxes wide and does not fit a pane, and a
 * half-applied permission change is exactly the edit you do not want possible.
 */
export function PermissionTemplateDetail({ orgId, templateId, onClose, onDelete }: Props) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'Overview' | 'Permissions'>('Overview');
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);

  const { data: template, isLoading } = useQuery({
    queryKey: ['permission-template', orgId, templateId],
    queryFn: () => permissionTemplatesApi.get(orgId, templateId),
    enabled: Boolean(orgId && templateId),
  });

  const { data: groups } = useQuery({
    queryKey: ['permission-catalog', orgId],
    queryFn: () => permissionTemplatesApi.catalog(orgId),
    staleTime: 60 * 60 * 1000, // static vocabulary — no need to refetch
  });

  const { data: membersData, isLoading: isLoadingMembers } = useQuery({
    queryKey: ['template-members', orgId, templateId],
    queryFn: () => membersApi.list(orgId, { filter: 'all_users', perPage: 500 }),
    enabled: isMembersModalOpen,
  });

  const assignedMembers = membersData?.results.filter(
    (u) => isMember(u) && u.permissionTemplateId === templateId
  ) ?? [];

  if (isLoading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
        Loading profile details...
      </div>
    );
  }

  if (!template) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
        Profile not found.
      </div>
    );
  }

  const granted = new Set(template.permissions);
  const tabs = ['Overview', 'Permissions'] as const;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #eef0f3',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1e293b', margin: 0 }}>
            {template.name}
          </h2>
          {template.isSystem && (
            <span
              title="Built-in profile — cannot be edited or deleted"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#f1f5f9',
                color: '#64748b',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '12px',
                fontWeight: 600,
              }}
            >
              <Lock size={11} /> Built-in
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* The built-in profile has no actions: the server refuses to edit or
              delete it, so offering the buttons would only produce a 403. */}
          {!template.isSystem && (
            <>
              <button
                onClick={() => setIsMembersModalOpen(!isMembersModalOpen)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d1d5db',
                  background: isMembersModalOpen ? '#f1f5f9' : 'white',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Users size={14} /> Assigned Members
              </button>
              <button
                onClick={() =>
                  navigate(`/organizations/${orgId}/settings/permissions/${templateId}/edit`)
                }
                style={{
                  padding: '6px 12px',
                  border: '1px solid #d1d5db',
                  background: 'white',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Edit size={14} /> Edit
              </button>
              <button
                onClick={() => onDelete(template)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #fecaca',
                  background: 'white',
                  borderRadius: '4px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  color: '#ef4444',
                }}
              >
                Delete
              </button>
            </>
          )}
          <button
            onClick={onClose}
            style={{
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {isMembersModalOpen && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: 0,
            zIndex: 100,
          }}
          onClick={(e) => { e.stopPropagation(); setIsMembersModalOpen(false); }}
        >
          <div
            style={{
              width: 500,
              maxWidth: '92vw',
              maxHeight: '80vh',
              background: '#fff',
              borderRadius: '0 0 8px 8px',
              boxShadow: '0 20px 45px rgba(0,0,0,0.22)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              textAlign: 'left',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eef0f3', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{template.name} — Assigned Members</h3>
              <button onClick={() => setIsMembersModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 0, overflowY: 'auto', flex: 1 }}>
              {isLoadingMembers ? (
                <div style={{ padding: '32px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>Loading...</div>
              ) : assignedMembers.length === 0 ? (
                <div style={{ padding: '48px 32px', fontSize: 13, color: '#64748b', textAlign: 'center' }}>This profile is not assigned to anyone</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {assignedMembers.map(member => (
                    <li key={member.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px 20px', borderBottom: '1px solid #f8fafc' }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: '#1e293b' }}>{member.fullName}</span>
                      <span style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{member.email}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          padding: '0 24px',
          borderBottom: '1px solid #eef0f3',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        {tabs.map((tab, idx) => (
          <Fragment key={tab}>
            {idx > 0 && <div style={{ height: '16px', width: '1px', background: '#cbd5e1' }} />}
            <div
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 0',
                fontSize: '14px',
                fontWeight: activeTab === tab ? 600 : 500,
                color: activeTab === tab ? '#0062ff' : '#64748b',
                borderBottom: activeTab === tab ? '2px solid #0062ff' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {tab}
            </div>
          </Fragment>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', padding: '24px' }}>
        {activeTab === 'Overview' ? (
          <div
            style={{
              background: '#fff',
              border: '1px solid #eef0f3',
              borderRadius: 6,
              padding: '20px 24px',
            }}
          >
            <div style={sectionHeaderStyle}>Profile Details</div>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr',
                rowGap: 14,
                columnGap: 16,
                margin: 0,
                fontSize: 13,
              }}
            >
              <dt style={labelStyle}>Description</dt>
              <dd style={valueStyle}>{template.description || '-'}</dd>

              <dt style={labelStyle}>Members on this profile</dt>
              <dd style={valueStyle}>{template.memberCount}</dd>

              <dt style={labelStyle}>Permissions granted</dt>
              <dd style={valueStyle}>
                {template.grantsAllPermissions
                  ? 'All permissions — resolved at runtime, so future modules are included automatically'
                  : `${template.permissions.length} permissions`}
              </dd>

              <dt style={labelStyle}>Created By &amp; Time</dt>
              <dd style={valueStyle}>
                {template.createdByName} · {new Date(template.createdAt).toLocaleString()}
              </dd>

              <dt style={labelStyle}>Modified By &amp; Time</dt>
              <dd style={valueStyle}>
                {template.updatedByName} · {new Date(template.updatedAt).toLocaleString()}
              </dd>
            </dl>

            {/* The counterpart of the pointer on the Roles page — the two screens
                are halves of one idea, and an admin who lands on the wrong one
                should be told rather than left hunting. */}
            <p style={{ fontSize: 12, color: '#64748b', margin: '20px 0 0 0', lineHeight: 1.6 }}>
              A profile is access, not a job title. Titles live in{' '}
              <Link
                to={`/organizations/${orgId}/settings/roles`}
                style={{ color: '#0062ff', fontWeight: 500 }}
              >
                Settings → Roles
              </Link>{' '}
              and are assigned to a member independently — the same title can hold different access.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groups?.map((group) => {
              // Only modules this profile actually touches. Listing every module
              // in the catalog with "nothing granted" beside it buries the answer
              // to the one question this tab exists to answer.
              const modules = group.modules
                .map((m) => ({
                  label: m.label,
                  actions: m.actions.filter((a) => granted.has(a.key)),
                }))
                .filter((m) => m.actions.length > 0);

              if (modules.length === 0) return null;

              return (
                <div
                  key={group.key}
                  style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 6 }}
                >
                  <div
                    style={{
                      padding: '10px 20px',
                      borderBottom: '1px solid #eef0f3',
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: '#64748b',
                    }}
                  >
                    {group.label}
                  </div>
                  {modules.map((m) => (
                    <div
                      key={m.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                        padding: '10px 20px',
                        borderBottom: '1px solid #f4f6f8',
                        fontSize: 13,
                      }}
                    >
                      <span style={{ color: '#1e293b', fontWeight: 500 }}>{m.label}</span>
                      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {m.actions.map((a) => (
                          <span
                            key={a.key}
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 999,
                              color: 'var(--color-check)',
                              background: 'var(--color-check-soft)',
                              border: '1px solid var(--color-check-border)',
                            }}
                          >
                            {a.label}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {granted.size === 0 && (
              <div
                style={{
                  background: '#fff',
                  border: '1px solid #eef0f3',
                  borderRadius: 6,
                  padding: '32px 24px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: 13,
                }}
              >
                This profile grants nothing yet. Anyone on it can sign in and see the organization,
                and nothing else.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const sectionHeaderStyle = {
  fontSize: '13px',
  fontWeight: 400,
  color: '#000',
  textTransform: 'uppercase' as const,
  marginBottom: '16px',
  borderBottom: '1px solid #eef0f3',
  paddingBottom: '8px',
};

const labelStyle = { color: '#64748b', margin: 0 };
const valueStyle = { color: '#1e293b', margin: 0 };
