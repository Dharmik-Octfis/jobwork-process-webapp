import { useAuth } from '../../providers/auth-context';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useUpdateProfile } from '../auth/useUpdateProfile';
import { useUploadAvatar } from '../auth/useUploadAvatar';
import { toApiErrorMessage } from '../../api/client';

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const updateProfileMutation = useUpdateProfile();
  const uploadAvatarMutation = useUploadAvatar();

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [logoPreview, setLogoPreview] = useState<string | null>(user?.avatar_url || null);
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

  const handleSave = () => {
    updateProfileMutation.mutate(
      { firstName, lastName },
      {
        onSuccess: () => {
          navigate(-1);
        },
      },
    );
  };

  return (
    <div
      style={{ padding: '32px', maxWidth: 600, margin: '0 auto', fontFamily: 'var(--font-family)' }}
    >
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-primary)',
          marginBottom: 24,
          fontSize: 14,
        }}
      >
        <ArrowLeft size={16} /> Back
      </button>

      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Edit Profile</h1>

      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 24,
        }}
      >
        {/* Profile Picture / Logo Section */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            marginBottom: 24,
            paddingBottom: 20,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Profile Logo"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-primary)' }}>
                {(firstName?.charAt(0) || user?.firstName?.charAt(0) || 'U').toUpperCase()}
                {(lastName?.charAt(0) || user?.lastName?.charAt(0) || '').toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <label style={{ fontWeight: 500, fontSize: 14, display: 'block', marginBottom: 4 }}>
              Profile Logo / Picture
            </label>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px 0' }}>
              Upload your profile image or logo. Recommended format: PNG or JPG up to 2MB.
            </p>
            {uploadError && (
              <p style={{ fontSize: 12, color: 'var(--color-danger)', margin: '0 0 8px 0' }}>
                {uploadError}
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoChange}
                style={{ fontSize: 13 }}
              />
              {logoPreview && (
                <button
                  type="button"
                  onClick={() => setLogoPreview(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-danger)',
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                marginBottom: 6,
              }}
            >
              First Name
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                marginBottom: 6,
              }}
            >
              Last Name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-muted)',
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
              padding: '6px 10px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              boxSizing: 'border-box',
              background: 'var(--color-bg)',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={handleSave}
            disabled={updateProfileMutation.isPending}
            style={{
              background: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              padding: '6px 16px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              opacity: updateProfileMutation.isPending ? 0.7 : 1,
            }}
          >
            {updateProfileMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          {updateProfileMutation.isError && (
            <span style={{ color: 'var(--color-danger)', fontSize: 14 }}>
              {toApiErrorMessage(updateProfileMutation.error)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
