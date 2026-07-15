import { X, FileText, Users, LogOut, User as UserIcon, Settings } from 'lucide-react';
import { Logo } from '../../components/ui/Logo';
import { useAuth } from '../../providers/auth-context';
import { useLogout } from '../auth/useLogout';
import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '../organizations/organizations.api';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Organization } from '../organizations/organizations.schemas';
import type { User } from '../auth/auth.types';

export function DashboardPage() {
  const { user } = useAuth();
  const logoutMutation = useLogout();

  const { data: organizations } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsApi.getOrganizations(),
  });

  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(() =>
    localStorage.getItem('activeOrgId'),
  );

  const activeOrgId = organizations?.some((o) => o.id === selectedOrgId)
    ? selectedOrgId
    : (organizations?.[0]?.id ?? null);

  useEffect(() => {
    if (activeOrgId) {
      localStorage.setItem('activeOrgId', activeOrgId);
    }
  }, [activeOrgId]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      {/* Topbar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-5)',
          background: 'var(--navy-900)',
          borderBottom: 'none',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Logo tone="dark" size={28} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <OrgDropdown
            organizations={organizations || []}
            activeOrgId={activeOrgId}
            onSelectOrg={setSelectedOrgId}
          />
          <ProfileDropdown user={user} logoutMutation={logoutMutation} />
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          padding: 'var(--space-6) var(--space-5)',
          maxWidth: 1100,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Welcome Banner */}
        <section
          style={{
            background: 'linear-gradient(135deg, var(--navy-900) 0%, var(--color-primary) 100%)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-6)',
            color: 'white',
            marginBottom: 'var(--space-6)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h2
              style={{
                fontSize: 32,
                fontWeight: 700,
                margin: '0 0 var(--space-2) 0',
                color: 'white',
              }}
            >
              Welcome back, {user?.fullName || 'User'}! 👋
            </h2>
            <p style={{ fontSize: 16, opacity: 0.9, margin: 0, maxWidth: 500, lineHeight: 1.6 }}>
              Here's what's happening in your workspace today. Manage your jobs, check approvals,
              and stay on top of your tasks.
            </p>
          </div>
          {/* Decorative circle */}
          <div
            style={{
              position: 'absolute',
              top: '-50%',
              right: '-5%',
              width: 300,
              height: 300,
              background: 'rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              filter: 'blur(40px)',
              zIndex: 0,
            }}
          />
        </section>

        {/* Stats Grid */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--space-5)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <StatCard title="Active Jobs" value="24" trend="+12% this week" isPositive={true} />
          <StatCard title="Pending Approvals" value="7" trend="-2% this week" isPositive={false} />
          <StatCard title="Total Revenue" value="$12,450" trend="+8% this week" isPositive={true} />
        </section>

        {/* Recent Activity Placeholder */}
        <section>
          <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 'var(--space-4)' }}>
            Recent Activity
          </h3>
          <div
            style={{
              background: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: 'var(--space-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
              color: 'var(--color-text-subtle)',
            }}
          >
            <p>Activity feed will appear here soon.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

// Simple internal component for the cards to keep code clean
function StatCard({
  title,
  value,
  trend,
  isPositive,
}: {
  title: string;
  value: string;
  trend: string;
  isPositive: boolean;
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          margin: '0 0 var(--space-2) 0',
        }}
      >
        {title}
      </h3>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: isPositive ? 'var(--color-success)' : 'var(--color-danger)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {isPositive ? '↑' : '↓'} {trend}
      </div>
    </div>
  );
}

function ProfileDropdown({
  user,
  logoutMutation,
}: {
  user: User | null;
  logoutMutation: ReturnType<typeof useLogout>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          color: 'white',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <UserIcon size={20} />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 350,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 20,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px', position: 'relative' }}>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#ef4444',
              }}
            >
              <X size={16} />
            </button>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '4px',
                  background: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                }}
              >
                <Users size={24} color="white" />
              </div>
              <div>
                <div style={{ fontWeight: 500, fontSize: 16, color: '#1e293b' }}>
                  {user?.fullName || 'User1Demo1'}
                </div>
                <div style={{ fontSize: 14, color: '#64748b' }}>
                  {user?.email || 'user1@demo1.octfis.com'}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: '1px solid #f1f5f9',
                paddingTop: 16,
              }}
            >
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/profile');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Edit Profile
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  logoutMutation.mutate();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgDropdown({
  organizations,
  activeOrgId,
  onSelectOrg,
}: {
  organizations: Organization[];
  activeOrgId: string | null;
  onSelectOrg: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const activeOrg = organizations?.find((o) => o.id === activeOrgId) || organizations?.[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        title={activeOrg?.name}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        <span>
          {activeOrg?.name
            ? activeOrg.name.length > 15
              ? activeOrg.name.substring(0, 15) + '...'
              : activeOrg.name
            : 'Select Organization'}
        </span>
        <span style={{ fontSize: 10 }}>▼</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 400,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 16px 12px',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Organizations</h3>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Organizations List */}
          <div style={{ padding: '16px 0', overflowY: 'auto' }}>
            <div style={{ padding: '0 16px', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              My Organizations
            </div>

            {organizations?.map((org) => (
              <div
                key={org.id}
                onClick={() => {
                  onSelectOrg(org.id);
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: org.id === activeOrgId ? '#f8fafc' : 'none',
                  borderLeft:
                    org.id === activeOrgId
                      ? '3px solid var(--color-primary)'
                      : '3px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (org.id !== activeOrgId) {
                    e.currentTarget.style.background = 'var(--color-bg)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (org.id !== activeOrgId) {
                    e.currentTarget.style.background = 'none';
                  }
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'white',
                  }}
                >
                  <FileText size={20} color="#94a3b8" />
                </div>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-text)' }}>
                    {org.name}
                  </div>
                  {org.id === activeOrgId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        navigate(`/organizations/${org.id}/settings`);
                      }}
                      title="Organization Settings"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-muted)',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--radius-sm)',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'var(--color-border)')
                      }
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                    >
                      <Settings size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {(!organizations || organizations.length === 0) && (
              <div
                style={{
                  padding: '16px',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 14,
                }}
              >
                No organizations found.
              </div>
            )}
          </div>

          <div
            style={{
              padding: '12px 16px',
              background: 'var(--color-surface)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/organizations/new');
              }}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              + Add Organization
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
