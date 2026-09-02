import { useAuth } from '../../providers/auth-context';
import { toast } from 'react-hot-toast';
import { Trash2, User, UploadCloud } from 'lucide-react';
import { useState, useRef } from 'react';
import { useUpdateProfile } from '../auth/useUpdateProfile';
import { useUploadAvatar } from '../auth/useUploadAvatar';
import { useDeleteAvatar } from '../auth/useDeleteAvatar';
import { toApiErrorMessage } from '../../api/client';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function ProfilePage() {
  const { user } = useAuth();
  const updateProfileMutation = useUpdateProfile();
  const uploadAvatarMutation = useUploadAvatar();
  const deleteAvatarMutation = useDeleteAvatar();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile details state
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [logoPreview, setLogoPreview] = useState<string | null>(user?.avatarUrl || null);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
          if (data.user.avatarUrl) {
            setLogoPreview(data.user.avatarUrl);
          }
          toast.success('Profile picture updated');
        },
        onError: (err) => {
          setUploadError(toApiErrorMessage(err));
        },
      });
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(
      { firstName, lastName },
      {
        onSuccess: () => {
          toast.success('Profile updated successfully');
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
      {/* Top Header */}
      <div style={{ marginBottom: 28 }}>
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
              <label
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: '#0f172a',
                  display: 'block',
                  marginBottom: 4,
                }}
              >
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
                    onClick={() => {
                      deleteAvatarMutation.mutate(undefined, {
                        onSuccess: () => {
                          setLogoPreview(null);
                          toast.success('Profile picture removed');
                        },
                      });
                    }}
                    disabled={deleteAvatarMutation.isPending}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: 'none',
                      border: 'none',
                      color: deleteAvatarMutation.isPending ? '#94a3b8' : '#dc2626',
                      cursor: deleteAvatarMutation.isPending ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      padding: '6px 8px',
                    }}
                  >
                    <Trash2 size={14} /> {deleteAvatarMutation.isPending ? 'Removing...' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleSaveProfile}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  required
                />
              </div>
              <div style={{ flex: 1 }}>
                <Input
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <Input
                label="Email"
                type="email"
                value={user?.email || ''}
                disabled
                hint="Email is managed by organization admin."
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Button type="submit" isLoading={updateProfileMutation.isPending}>
                Save Profile
              </Button>
              {updateProfileMutation.isError && (
                <span style={{ color: 'var(--color-danger)', fontSize: 13, fontWeight: 500 }}>
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
