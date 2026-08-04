import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Pencil, Trash2, UserCheck, UserX, X } from 'lucide-react';
import { toApiErrorMessage } from '../../api/client';
import { Select } from '../../components/ui/Select';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { organizationsApi } from '../organizations/organizations.api';
import { membersApi, type Member, type OrgUser, isMember } from '../members/members.api';
import { invitationsApi } from '../invitations/invitations.api';
import type { Role } from '../roles/roles.api';
import type { PermissionTemplate } from '../permission-templates/permissionTemplates.api';
import { UserAvatar } from './UserAvatar';

/**
 * The right-hand pane: one person's record **in this organization**.
 *
 * 🔴 Everything here except Email is per-org. Editing a name changes it in this
 * organization only — not in any other org the person belongs to, and not on their
 * account. That is the whole point of the model, and it is why the section is
 * labelled with the organization name rather than "Profile".
 *
 * An unaccepted invitation has no record to show — there is no membership row yet —
 * so it renders what the invite says plus the two actions that apply to it.
 */

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(40),
  lastName: z.string().trim().min(1, 'Last name is required').max(40),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Phone must be exactly 10 digits')
    .optional()
    .or(z.literal('')),
  mobile: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Mobile must be exactly 10 digits')
    .optional()
    .or(z.literal('')),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  addressLine1: z.string().trim().max(255).optional(),
  addressLine2: z.string().trim().max(255).optional(),
  zip: z.string().trim().max(20).optional(),
  countryCode: z.string().optional(),
  stateCode: z.string().optional(),
  cityId: z.string().optional(),
  roleId: z.string().optional(),
  permissionTemplateId: z.string().min(1, 'Select a permission template'),
});

type ProfileValues = z.infer<typeof profileSchema>;

type MasterData = {
  states: {
    code: string;
    name: string;
    countryCode: string;
    cities: { id: string; name: string }[];
  }[];
  countries: { id: string; code: string; name: string }[];
};

interface UserDetailPanelProps {
  orgId: string;
  organizationName: string | undefined;
  user: OrgUser | null;
  roles: Role[];
  templates: PermissionTemplate[];
  /** The signed-in user's own membership id, when they are a member here. Drives the
   * "this is you" rules — the server enforces them regardless. */
  myMembershipId: string | null;
  onDeselect: () => void;
}

/** An unset optional value. A dash reads as "nothing here"; a blank cell reads as a
 * bug. */
function ReadField({
  label,
  value,
  span,
}: {
  label: string;
  value: string | null;
  span?: boolean;
}) {
  return (
    <div className={span ? 'users-field-span' : undefined}>
      <span className="users-field-label">{label}</span>
      <div className={`users-field-value ${value ? '' : 'is-empty'}`}>{value || '—'}</div>
    </div>
  );
}

/** "Owner › Manager › Supervisor", or the bare name when the tree is flat. */
function rolePathLabel(path: string[], fallback: string | null): string | null {
  if (path.length > 1) return path.join(' › ');
  return path[0] ?? fallback;
}

function formatAddress(user: Member): string | null {
  const parts = [
    user.address.line1,
    user.address.line2,
    user.address.cityName,
    user.address.stateName,
    user.address.countryName,
    user.address.zip,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function UserDetailPanel({
  orgId,
  organizationName,
  user,
  roles,
  templates,
  myMembershipId,
  onDeselect,
}: UserDetailPanelProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'remove' | 'revoke' | 'deactivate' | null>(null);

  const [masterData, setMasterData] = useState<MasterData | null>(null);

  useEffect(() => {
    organizationsApi
      .getSeedData()
      .then(setMasterData)
      .catch((err) => console.error('Failed to load master data:', err));
  }, []);

  const assignableRoles = roles.filter((r) => !r.isSystem);
  const assignableTemplates = templates.filter((t) => !t.isSystem);

  const member = user && isMember(user) ? user : null;
  const isSelf = member !== null && member.id === myMembershipId;
  // The owner's role, access and status are immutable, and so is your own record via
  // this pane — both are refused by the server too; disabling here just avoids
  // offering an action that cannot succeed.
  const isLocked = member?.isOwner === true || isSelf;

  /**
   * Seeded at mount, never re-synced by an effect.
   *
   * `UsersPage` gives this component a `key` of the selected id, so picking a
   * different person remounts it and these defaults are simply the new person's
   * values. That replaces a `useEffect(() => reset(...))` — which React now flags,
   * costs an extra render per selection, and would need its own guard to avoid
   * clobbering half-typed edits.
   */
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: member
      ? {
          firstName: member.firstName,
          lastName: member.lastName,
          phone: member.phone ?? '',
          mobile: member.mobile ?? '',
          dateOfBirth: member.dateOfBirth ?? '',
          addressLine1: member.address.line1 ?? '',
          addressLine2: member.address.line2 ?? '',
          zip: member.address.zip ?? '',
          countryCode: member.address.countryCode ?? '',
          stateCode: member.address.stateCode ?? '',
          cityId: member.address.cityId ?? '',
          roleId: member.roleId ?? '',
          permissionTemplateId: member.permissionTemplateId ?? '',
        }
      : { firstName: '', lastName: '' },
  });

  const selectedCountryCode = watch('countryCode');
  const selectedStateCode = watch('stateCode');

  const availableStates =
    masterData?.states.filter(
      (s) => !selectedCountryCode || s.countryCode === selectedCountryCode,
    ) || [];

  const availableCities =
    masterData?.states.find((s) => s.code === selectedStateCode)?.cities || [];

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['org-users', orgId] });
  };

  const updateMutation = useMutation({
    mutationFn: (body: Parameters<typeof membersApi.update>[2]) =>
      membersApi.update(orgId, member!.id, body),
    onSuccess: async () => {
      setServerError(null);
      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['org-users', orgId], exact: false });
      await queryClient.invalidateQueries({ queryKey: ['org-users-count', orgId], exact: false });
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const removeMutation = useMutation({
    mutationFn: () => membersApi.remove(orgId, member!.id),
    onSuccess: () => {
      setServerError(null);
      onDeselect();
      void invalidate();
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: () => invitationsApi.revoke(orgId, user!.id),
    onSuccess: () => {
      setServerError(null);
      onDeselect();
      void invalidate();
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const resendMutation = useMutation({
    mutationFn: () => {
      const invite = user as Extract<OrgUser, { kind: 'invite' }>;
      // Re-sending IS re-inviting: it mints a fresh token and resets the expiry.
      // Names are sent again because the latest invite wins server-side, so an
      // omitted name would blank what the admin already entered.
      return invitationsApi.create(orgId, {
        email: invite.email,
        firstName: invite.firstName ?? '',
        lastName: invite.lastName ?? '',
        permissionTemplateId: invite.permissionTemplateId,
        ...(invite.roleId ? { roleId: invite.roleId } : {}),
      });
    },
    onSuccess: () => {
      setServerError(null);
      void invalidate();
    },
    onError: (err) => setServerError(toApiErrorMessage(err)),
  });

  const onSubmit = handleSubmit((values) => {
    // '' from a text input means "cleared" and must reach the API as null — sending
    // '' would store an empty string, which reads as data rather than as absence.
    const orNull = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);

    updateMutation.mutate({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: orNull(values.phone),
      mobile: orNull(values.mobile),
      dateOfBirth: orNull(values.dateOfBirth),
      addressLine1: orNull(values.addressLine1),
      addressLine2: orNull(values.addressLine2),
      zip: orNull(values.zip),
      countryCode: orNull(values.countryCode),
      stateCode: orNull(values.stateCode),
      cityId: orNull(values.cityId),
      // Role and access are only sent when this pane is allowed to change them.
      ...(isLocked
        ? {}
        : {
            roleId: values.roleId ? values.roleId : null,
            ...(values.permissionTemplateId
              ? { permissionTemplateId: values.permissionTemplateId }
              : {}),
          }),
    });
  });

  if (!user) {
    return (
      <section className="users-detail">
        <div className="users-empty" style={{ padding: 'var(--space-8, 56px) var(--space-6)' }}>
          Select someone from the list to see their details.
        </div>
      </section>
    );
  }

  // ── An unaccepted invitation ──────────────────────────────────────────────
  if (!member) {
    const invite = user as Extract<OrgUser, { kind: 'invite' }>;

    return (
      <section className="users-detail">
        <div className="users-detail-head">
          <UserAvatar name={invite.fullName} size={46} />
          <div className="users-detail-identity">
            <h2 className="users-detail-name">
              {invite.fullName}
              <span
                className={`users-badge ${
                  invite.inviteStatus === 'declined' ? 'is-declined' : 'is-unconfirmed'
                }`}
              >
                {invite.inviteStatus === 'declined' ? 'Declined' : 'Unconfirmed'}
              </span>
            </h2>
            <div className="users-detail-sub">{invite.email}</div>
          </div>
          <div className="users-detail-actions">
            {/* Without this the table stays collapsed to the narrow master pane with
                no way back — the only other route out is removing the person. */}
            <button
              type="button"
              className="users-btn"
              onClick={onDeselect}
              title="Close"
              aria-label="Close details"
            >
              <X size={15} />
            </button>
            <button
              type="button"
              className="users-btn"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending}
            >
              <Mail size={15} />
              {resendMutation.isPending ? 'Sending…' : 'Resend'}
            </button>
            <button
              type="button"
              className="users-btn is-danger"
              onClick={() => setConfirm('revoke')}
            >
              <Trash2 size={15} /> Revoke
            </button>
          </div>
        </div>

        <div className="users-section">
          {serverError && <div className="users-alert is-error">{serverError}</div>}
          <div className="users-alert is-info">
            {invite.inviteStatus === 'declined'
              ? 'This person declined the invitation. Re-sending it makes the invite live again.'
              : 'This person has been invited but has not accepted yet. Their record is created when they join.'}
          </div>
          <div className="users-grid">
            <ReadField label="First name" value={invite.firstName} />
            <ReadField label="Last name" value={invite.lastName} />
            <ReadField label="Email" value={invite.email} />
            <ReadField label="Role" value={rolePathLabel(invite.rolePath, invite.roleName)} />
            <ReadField label="Profile" value={invite.permissionTemplateName} />
            <ReadField label="Added by" value={invite.addedByName} />
            <ReadField
              label="Invite expires"
              value={new Date(invite.expiresAt).toLocaleDateString()}
            />
          </div>
        </div>

        <ConfirmDialog
          isOpen={confirm === 'revoke'}
          title="Revoke invitation"
          message="Revoke this invitation? The link they were sent will stop working."
          confirmText="Revoke"
          onConfirm={() => {
            revokeMutation.mutate();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
          isConfirming={revokeMutation.isPending}
        />
      </section>
    );
  }

  // ── A joined member ───────────────────────────────────────────────────────
  const roleOptions = [
    { value: '', label: 'No role' },
    ...assignableRoles.map((r) => ({
      value: r.id,
      label: `${'  '.repeat(r.depth)}${r.depth > 0 ? '└ ' : ''}${r.name}`,
    })),
  ];

  const permissionTemplateOptions = [
    { value: '', label: 'Select a template…' },
    ...assignableTemplates.map((t) => ({ value: t.id, label: t.name })),
  ];

  const currentRoleOption = member?.roleId ? roles.find((r) => r.id === member.roleId) : null;

  const currentTemplateOption = member?.permissionTemplateId
    ? templates.find((t) => t.id === member.permissionTemplateId)
    : null;

  const roleSelectOptions = currentRoleOption
    ? [
        {
          value: currentRoleOption.id,
          label: `${'  '.repeat(currentRoleOption.depth)}${currentRoleOption.depth > 0 ? '└ ' : ''}${currentRoleOption.name}`,
        },
        ...roleOptions.filter((option) => option.value !== currentRoleOption.id),
      ]
    : roleOptions;

  const templateSelectOptions = currentTemplateOption
    ? [
        { value: currentTemplateOption.id, label: currentTemplateOption.name },
        ...permissionTemplateOptions.filter((option) => option.value !== currentTemplateOption.id),
      ]
    : permissionTemplateOptions;

  return (
    <section className="users-detail">
      <div className="users-detail-head">
        <UserAvatar name={member.fullName} url={member.avatarUrl} size={46} />
        <div className="users-detail-identity">
          <h2 className="users-detail-name">
            {member.fullName}
            <span className={`users-badge is-${member.status}`}>
              {member.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </h2>
          <div className="users-detail-sub">
            {[member.roleName, member.permissionTemplateName].filter(Boolean).join(' · ')}
          </div>
          <div className="users-detail-sub">{member.email}</div>
        </div>

        <div className="users-detail-actions">
          {!isEditing && (
            <>
              {/* Without this the table stays collapsed to the narrow master pane
                  with no way back — the only other route out is removing the person. */}
              <button
                type="button"
                className="users-btn"
                onClick={onDeselect}
                title="Close"
                aria-label="Close details"
              >
                <X size={15} />
              </button>
              <button type="button" className="users-btn" onClick={() => setIsEditing(true)}>
                <Pencil size={15} /> Edit
              </button>

              {/* Deactivate before Remove: it is reversible, ends access just as
                  immediately, and keeps their history and attribution intact. */}
              {!isLocked && (
                <>
                  <button
                    type="button"
                    className="users-btn"
                    onClick={() =>
                      member.status === 'active'
                        ? setConfirm('deactivate')
                        : updateMutation.mutate({ isActive: true })
                    }
                    disabled={updateMutation.isPending}
                  >
                    {member.status === 'active' ? (
                      <>
                        <UserX size={15} /> Deactivate
                      </>
                    ) : (
                      <>
                        <UserCheck size={15} /> Activate
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="users-btn is-danger"
                    onClick={() => setConfirm('remove')}
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {serverError && (
        <div className="users-section" style={{ paddingBottom: 0, borderBottom: 'none' }}>
          <div className="users-alert is-error">{serverError}</div>
        </div>
      )}

      <form id="user-detail-form" onSubmit={onSubmit} noValidate>
        <div className="users-section">
          <h3 className="users-section-title">
            {/* Named after the org on purpose: it is the one cue that tells someone
                this name is not their account name — and the contrast with the
                "Account details" heading below is what makes the split legible. */}
            Details in {organizationName ?? 'this organization'}
          </h3>

          <div className="users-grid">
            {isEditing ? (
              <>
                <div>
                  <label className="users-field-label required" htmlFor="ud-first">
                    First name *
                  </label>
                  <input
                    id="ud-first"
                    className={`users-input ${errors.firstName ? 'error' : ''}`}
                    {...register('firstName')}
                  />
                  {errors.firstName && (
                    <p className="users-error-msg">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <label className="users-field-label required" htmlFor="ud-last">
                    Last name *
                  </label>
                  <input
                    id="ud-last"
                    className={`users-input ${errors.lastName ? 'error' : ''}`}
                    {...register('lastName')}
                  />
                  {errors.lastName && <p className="users-error-msg">{errors.lastName.message}</p>}
                </div>
              </>
            ) : (
              <>
                <ReadField label="First name" value={member.firstName} />
                <ReadField label="Last name" value={member.lastName} />
              </>
            )}

            {/* Email is the account, shared by every org — never editable here. */}
            <div>
              <span className="users-field-label">Email</span>
              <div className="users-field-value">{member.email}</div>
            </div>

            <div>
              <span className="users-field-label">Role</span>
              {isEditing ? (
                <Controller
                  control={control}
                  name="roleId"
                  render={({ field }) => (
                    <Select
                      value={field.value || ''}
                      onChange={field.onChange}
                      options={roleSelectOptions}
                      ariaLabel="Role"
                      disabled={isLocked}
                    />
                  )}
                />
              ) : (
                <div className={`users-field-value ${member.roleName ? '' : 'is-empty'}`}>
                  {member.roleName || '—'}
                </div>
              )}
            </div>

            <div>
              <span className="users-field-label">Profile (permissions)</span>
              {isEditing ? (
                <Controller
                  control={control}
                  name="permissionTemplateId"
                  render={({ field }) => (
                    <Select
                      value={field.value || ''}
                      onChange={field.onChange}
                      disabled={isLocked}
                      hasError={Boolean(errors.permissionTemplateId)}
                      options={templateSelectOptions}
                      ariaLabel="Permission template"
                    />
                  )}
                />
              ) : (
                <div
                  className={`users-field-value ${member.permissionTemplateName ? '' : 'is-empty'}`}
                >
                  {member.permissionTemplateName ?? 'No access'}
                </div>
              )}
            </div>

            <ReadField label="Added by" value={member.addedByName} />
          </div>
        </div>

        <div className="users-section">
          {/* 🔴 Named for the blast radius, not the content. These columns live on
              the account, so an admin editing a phone number here changes it for
              every organization this person belongs to. Without the heading and the
              note below there is nothing on screen that would tell them. */}
          <h3 className="users-section-title">Account details</h3>
          <p
            style={{
              margin: '-8px 0 var(--space-4)',
              fontSize: 12,
              color: 'var(--color-text-muted)',
            }}
          >
            Shared across every organization {member.firstName} belongs to. Their name above is not
            — that is specific to {organizationName ?? 'this organization'}.
          </p>
          <div className="users-grid">
            {isEditing ? (
              <>
                <div>
                  <label className="users-field-label" htmlFor="ud-phone">
                    Phone
                  </label>
                  <input
                    id="ud-phone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    placeholder="0123456789"
                    className={`users-input ${errors.phone ? 'error' : ''}`}
                    onInput={(event) => {
                      const input = event.currentTarget as HTMLInputElement;
                      input.value = input.value.replace(/\D/g, '');
                    }}
                    {...register('phone')}
                  />
                  {errors.phone && <p className="users-error-msg">{errors.phone.message}</p>}
                </div>
                <div>
                  <label className="users-field-label" htmlFor="ud-mobile">
                    Mobile
                  </label>
                  <input
                    id="ud-mobile"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    placeholder="0123456789"
                    className={`users-input ${errors.mobile ? 'error' : ''}`}
                    onInput={(event) => {
                      const input = event.currentTarget as HTMLInputElement;
                      input.value = input.value.replace(/\D/g, '');
                    }}
                    {...register('mobile')}
                  />
                  {errors.mobile && <p className="users-error-msg">{errors.mobile.message}</p>}
                </div>
                <div>
                  <label className="users-field-label" htmlFor="ud-dob">
                    Date of birth
                  </label>
                  <input
                    id="ud-dob"
                    type="date"
                    className={`users-input ${errors.dateOfBirth ? 'error' : ''}`}
                    {...register('dateOfBirth')}
                  />
                  {errors.dateOfBirth && (
                    <p className="users-error-msg">{errors.dateOfBirth.message}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <ReadField label="Phone" value={member.phone} />
                <ReadField label="Mobile" value={member.mobile} />
                <ReadField
                  label="Date of birth"
                  value={
                    member.dateOfBirth
                      ? // Parsed as UTC midnight to match how it is stored; using the
                        // local parser would render the previous day west of UTC.
                        new Date(`${member.dateOfBirth}T00:00:00Z`).toLocaleDateString(undefined, {
                          timeZone: 'UTC',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : null
                  }
                />
              </>
            )}
          </div>
        </div>

        <div className="users-section">
          {/* Also on the account — same shared scope as the block above. */}
          <h3 className="users-section-title">Address · shared</h3>
          {isEditing ? (
            <div className="users-grid">
              <div className="users-field-span">
                <label className="users-field-label" htmlFor="ud-a1">
                  Address line 1
                </label>
                <input id="ud-a1" className="users-input" {...register('addressLine1')} />
              </div>
              <div className="users-field-span">
                <label className="users-field-label" htmlFor="ud-a2">
                  Address line 2
                </label>
                <input id="ud-a2" className="users-input" {...register('addressLine2')} />
              </div>
              <div>
                <label className="users-field-label" htmlFor="ud-zip">
                  Pin Code
                </label>
                <input id="ud-zip" className="users-input" {...register('zip')} />
              </div>
              <div>
                <label className="users-field-label">Country</label>
                <Controller
                  name="countryCode"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={
                        masterData?.countries.map((c) => ({ label: c.name, value: c.code })) || []
                      }
                      value={field.value ?? ''}
                      onChange={(val) => {
                        if (val !== field.value) {
                          field.onChange(val);
                          setValue('stateCode', '');
                          setValue('cityId', '');
                        }
                      }}
                      disabled={!masterData}
                      placeholder="Select Country"
                    />
                  )}
                />
              </div>
              <div>
                <label className="users-field-label">State</label>
                <Controller
                  name="stateCode"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={availableStates.map((s) => ({ label: s.name, value: s.code }))}
                      value={field.value ?? ''}
                      onChange={(val) => {
                        if (val !== field.value) {
                          field.onChange(val);
                          setValue('cityId', '');
                        }
                      }}
                      disabled={!selectedCountryCode}
                      placeholder="Select State"
                    />
                  )}
                />
              </div>
              <div>
                <label className="users-field-label">City</label>
                <Controller
                  name="cityId"
                  control={control}
                  render={({ field }) => (
                    <SearchableSelect
                      options={availableCities.map((c) => ({ label: c.name, value: c.id }))}
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      disabled={!selectedStateCode}
                      placeholder="Select City"
                    />
                  )}
                />
              </div>
            </div>
          ) : (
            <div className="users-grid">
              <ReadField label="Address" value={formatAddress(member)} span />
            </div>
          )}
        </div>

        {isEditing && (
          <div
            style={{
              padding: '12px 24px',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              background: '#fafafa',
            }}
          >
            <button type="button" className="users-btn" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="users-btn is-primary"
              disabled={updateMutation.isPending || !isDirty}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </form>

      <ConfirmDialog
        isOpen={confirm === 'deactivate'}
        title="Deactivate user"
        message="They will lose access to this organization immediately, on every device. Their records and history stay intact, and you can reactivate them at any time."
        confirmText="Deactivate"
        onConfirm={() => {
          updateMutation.mutate({ isActive: false });
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
        isConfirming={updateMutation.isPending}
      />

      <ConfirmDialog
        isOpen={confirm === 'remove'}
        title="Remove user"
        message="Remove this person from the organization? They lose access immediately. Their name is kept so past records still show who created them — deactivating instead is reversible."
        confirmText="Remove"
        onConfirm={() => {
          removeMutation.mutate();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
        isConfirming={removeMutation.isPending}
      />
    </section>
  );
}
