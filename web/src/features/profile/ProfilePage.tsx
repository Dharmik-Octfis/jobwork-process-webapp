import { useAuth } from '../../providers/auth-context';
import {
  ArrowLeft,
  Trash2,
  User,
  UploadCloud,
  CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, useRef } from 'react';
import { useUpdateProfile } from '../auth/useUpdateProfile';
import { useUploadAvatar } from '../auth/useUploadAvatar';
import { toApiErrorMessage } from '../../api/client';

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const updateProfileMutation = useUpdateProfile();
  const uploadAvatarMutation = useUploadAvatar();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile details state
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [logoPreview, setLogoPreview] = useState<string | null>(user?.avatar_url || null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setUploadError('Image size must be 2 MB or less.');
        e.target.value = '';
        return;
      }
      setUploadError(null);
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
      uploadAvatarMutation.mutate(file, {
        onSuccess: (data) => {
          if (data.user.avatar_url) {
            setLogoPreview(data.user.avatar_url);
          }
        },
        onError: (err) => {
          setUploadError(toApiErrorMessage(err));
        },
      });
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccessMsg(null);
    updateProfileMutation.mutate(
      { firstName, lastName },
      {
        onSuccess: () => {
          setProfileSuccessMsg('Profile updated successfully.');
        },
      },
    );
  };

  return (
    <div
      style={{
        padding: '32px 24px',
        maxWidth: '640px',
        margin: '0 auto',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Header & Navigation */}
      <div style={{ marginBottom: 28 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#475569',
            fontSize: 13,
            fontWeight: 500,
            padding: 0,
            marginBottom: 16,
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#0f172a')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#475569')}
        >
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px 0', color: '#0f172a' }}>
          Account Settings
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
          Manage your personal information and profile image.
        </p>
      </div>

      {/* Main Container Stack */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Profile Info Card */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#0f172a' }}>
                Personal Profile
              </h2>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Your avatar and basic account details
              </span>
            </div>
          </div>

          {profileSuccessMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#166534',
                fontSize: 13,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <CheckCircle2 size={16} color="#166534" />
              {profileSuccessMsg}
            </div>
          )}

          {/* Profile Picture Upload Section */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              marginBottom: 24,
              padding: '16px',
              background: '#f8fafc',
              borderRadius: '10px',
              border: '1px solid #f1f5f9',
            }}
          >
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                border: '2px solid #ffffff',
                background: '#e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
              }}
            >
              {logoPreview ? (
                <img
                  src={logoPreview}
                  alt="Profile Logo"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <span style={{ fontSize: 22, fontWeight: 600, color: '#475569' }}>
                  {(firstName?.charAt(0) || user?.firstName?.charAt(0) || 'U').toUpperCase()}
                  {(lastName?.charAt(0) || user?.lastName?.charAt(0) || '').toUpperCase()}
                </span>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', display: 'block', marginBottom: 4 }}>
                Profile Picture
              </label>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                PNG, JPG or WebP up to 2MB.
              </p>
              {uploadError && (
                <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 8px 0', fontWeight: 500 }}>
                  {uploadError}
                </p>
              )}

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleLogoChange}
                style={{ display: 'none' }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatarMutation.isPending}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    color: '#334155',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: uploadAvatarMutation.isPending ? 'not-allowed' : 'pointer',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#94a3b8')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                >
                  <UploadCloud size={14} color="#2563eb" />
                  {uploadAvatarMutation.isPending ? 'Uploading...' : 'Upload Image'}
                </button>

                {logoPreview && (
                  <button
                    type="button"
                    onClick={() => setLogoPreview(null)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      color: '#dc2626',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      padding: '6px 8px',
                    }}
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveProfile}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#334155',
                    marginBottom: 6,
                  }}
                >
                  First Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#334155',
                    marginBottom: 6,
                  }}
                >
                  Last Name <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    outline: 'none',
                    transition: 'border-color 0.15s ease',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = '#2563eb')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                />
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#334155',
                  marginBottom: 6,
                }}
              >
                Email Address
              </label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  fontSize: 13,
                  boxSizing: 'border-box',
                  background: '#f8fafc',
                  color: '#64748b',
                  cursor: 'not-allowed',
                }}
              />
              <span style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'block' }}>
                Email address is managed by organization admin.
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="submit"
                disabled={updateProfileMutation.isPending}
                style={{
                  background: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 20px',
                  borderRadius: '6px',
                  cursor: updateProfileMutation.isPending ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: updateProfileMutation.isPending ? 0.7 : 1,
                  boxShadow: '0 1px 2px rgba(37, 99, 235, 0.2)',
                  transition: 'background-color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!updateProfileMutation.isPending) e.currentTarget.style.background = '#1d4ed8';
                }}
                onMouseLeave={(e) => {
                  if (!updateProfileMutation.isPending) e.currentTarget.style.background = '#2563eb';
                }}
              >
                {updateProfileMutation.isPending ? 'Saving...' : 'Save Profile'}
              </button>
              {updateProfileMutation.isError && (
                <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 500 }}>
                  {toApiErrorMessage(updateProfileMutation.error)}
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


