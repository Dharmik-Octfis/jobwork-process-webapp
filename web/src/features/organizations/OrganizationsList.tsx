import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { organizationsApi } from './organizations.api';
import type { Organization } from './organizations.schemas';
import { PendingInvitationsPanel } from '../invitations/PendingInvitationsPanel';

export function OrganizationsList() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchOrganizations = async () => {
      try {
        const data = await organizationsApi.getOrganizations();
        if (mounted) {
          setOrganizations(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError('Failed to load organizations.');
          console.error(err);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    fetchOrganizations();
    return () => {
      mounted = false;
    };
  }, []);

  if (isLoading) {
    return <div className="p-8">Loading organizations...</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Your Organizations</h1>
        <Link
          to="/organizations/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition"
        >
          Create Organization
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6">{error}</div>}

      {/* Invitations addressed to this user. Renders nothing when there are none,
          so it only appears when there is actually something to act on. */}
      <PendingInvitationsPanel />

      {organizations.length === 0 && !error ? (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
          <p className="mb-4">You are not a member of any organization yet.</p>
          <Link to="/organizations/new" className="text-blue-600 hover:underline">
            Create your first organization
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {organizations.map((org) => (
            <div
              key={org.id}
              className="bg-white border rounded-lg p-6 shadow-sm hover:shadow-md transition"
            >
              <h3 className="font-semibold text-lg mb-2">{org.name}</h3>
              {org.industry?.name && (
                <p className="text-sm text-gray-500 mb-1">Industry: {org.industry.name}</p>
              )}
              {org.portalName && <p className="text-sm text-gray-500">Portal: {org.portalName}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
