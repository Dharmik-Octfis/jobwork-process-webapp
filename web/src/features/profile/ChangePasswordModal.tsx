import { useEffect, useState } from 'react';
import { X, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { z } from 'zod';
import { useChangePassword } from '../auth/useChangePassword';
import { changePasswordSchema } from '../auth/auth.schemas';
import { toApiErrorMessage } from '../../api/client';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  error,
  showPassword,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  error?: string;
  showPassword: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 500,
          color: '#334155',
          marginBottom: 6,
        }}
      >
        {label} <span style={{ color: '#dc2626' }}>*</span>
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '9px 38px 9px 12px',
            border: error ? '1px solid #ef4444' : '1px solid #cbd5e1',
            borderRadius: '6px',
            fontSize: 13,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && (
        <span style={{ color: '#dc2626', fontSize: 12, marginTop: 4, display: 'block', fontWeight: 500 }}>
          {error}
        </span>
      )}
    </div>
  );
}

export function ChangePasswordModal({ isOpen, onClose }: ChangePasswordModalProps) {
  const changePasswordMutation = useChangePassword();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setPasswordErrors({});
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors({});

    try {
      changePasswordSchema.parse({ currentPassword, newPassword, confirmPassword });
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        err.issues.forEach((issue) => {
          const field = issue.path[0]?.toString() || 'general';
          errors[field] = issue.message;
        });
        setPasswordErrors(errors);
        return;
      }
    }

    changePasswordMutation.mutate(
      { currentPassword, newPassword, confirmPassword },
      {
        onSuccess: () => {
          resetForm();
          onClose();
        },
        onError: (err) => {
          setPasswordErrors({ general: toApiErrorMessage(err) });
        },
      },
    );
  };

  return (
    <>
      <style>
        {`
          @keyframes changePasswordModalSlideDown {
            from { opacity: 0; transform: translateY(-50px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes changePasswordModalFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}
      </style>
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          zIndex: 100,
          animation: 'changePasswordModalFadeIn 0.2s ease-out forwards',
        }}
        onClick={handleClose}
      >
        <div
          style={{
            background: 'white',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            width: '100%',
            maxWidth: 520,
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            animation: 'changePasswordModalSlideDown 0.3s ease-out forwards',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Change Password</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
                Update your account password for security
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{ padding: 'var(--space-5)', overflowY: 'auto' }}>
            {passwordErrors.general && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  fontSize: 13,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={16} color="#dc2626" />
                {passwordErrors.general}
              </div>
            )}

            <form id="change-password-form" onSubmit={handleSubmit}>
              <PasswordField
                label="Current Password"
                value={currentPassword}
                onChange={setCurrentPassword}
                placeholder="Enter your current password"
                error={passwordErrors.currentPassword}
                showPassword={showCurrentPassword}
                onToggleVisibility={() => setShowCurrentPassword((prev) => !prev)}
              />

              <PasswordField
                label="New Password"
                value={newPassword}
                onChange={setNewPassword}
                placeholder="At least 8 characters"
                error={passwordErrors.newPassword}
                showPassword={showNewPassword}
                onToggleVisibility={() => setShowNewPassword((prev) => !prev)}
              />

              <PasswordField
                label="Confirm New Password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter new password"
                error={passwordErrors.confirmPassword}
                showPassword={showConfirmPassword}
                onToggleVisibility={() => setShowConfirmPassword((prev) => !prev)}
              />
            </form>
          </div>

          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-3)',
              background: 'var(--color-bg)',
              borderBottomLeftRadius: 'var(--radius-lg)',
              borderBottomRightRadius: 'var(--radius-lg)',
            }}
          >
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'white',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              Cancel
            </button>
            <button
              form="change-password-form"
              type="submit"
              disabled={changePasswordMutation.isPending}
              style={{
                padding: '8px 16px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: '#059669',
                color: 'white',
                cursor: changePasswordMutation.isPending ? 'not-allowed' : 'pointer',
                fontWeight: 500,
                fontSize: 14,
                opacity: changePasswordMutation.isPending ? 0.7 : 1,
              }}
            >
              {changePasswordMutation.isPending ? 'Updating Password...' : 'Update Password'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
