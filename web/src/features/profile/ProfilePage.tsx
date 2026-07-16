import { useAuth } from '../../providers/auth-context';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUpdateProfile } from '../auth/useUpdateProfile';
import { useState } from 'react';
import { toApiErrorMessage } from '../../api/client';

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const updateProfileMutation = useUpdateProfile();

  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');

  const handleSave = () => {
    updateProfileMutation.mutate(
      { firstName, lastName },
      {
        onSuccess: () => {
          navigate('/dashboard');
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
