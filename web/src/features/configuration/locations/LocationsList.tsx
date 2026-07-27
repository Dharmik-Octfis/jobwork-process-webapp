import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Edit2, Trash2, Star } from 'lucide-react';
import { fetchLocations, deleteLocation, type Location } from './locations.api';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

export function LocationsList() {
  const navigate = useNavigate();
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();

  const [locationToDelete, setLocationToDelete] = useState<string | null>(null);

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => fetchLocations(orgId!),
    enabled: Boolean(orgId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocation(orgId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations', orgId] });
      setLocationToDelete(null);
    },
  });

  // Group locations into a tree structure
  const rootLocations = locations.filter((loc) => !loc.parentId);
  const getChildLocations = (parentId: string) => locations.filter((loc) => loc.parentId === parentId);

  const renderLocationRow = (location: Location, depth = 0, isLastArray: boolean[] = []) => {
    const children = getChildLocations(location.id);
    const hasChildren = children.length > 0;

    return (
      <Fragment key={location.id}>
        <tr
          style={{
            borderBottom: '1px solid #eef0f3',
            background: 'transparent',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <td style={{ padding: 0 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 48, paddingLeft: depth * 32 + 16, paddingRight: 16 }}>
              
              {/* 1. Vertical lines for passing-through ancestors */}
              {Array.from({ length: Math.max(0, depth - 1) }).map((_, i) => {
                if (isLastArray[i]) return null;
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * 32 + 16 + 5.5,
                      top: 0,
                      bottom: -1,
                      width: 1,
                      background: '#cbd5e1',
                    }}
                  />
                );
              })}

              {/* 2. L-connector from parent to current node (if not root) */}
              {depth > 0 && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      left: (depth - 1) * 32 + 16 + 5.5,
                      top: 0,
                      bottom: isLastArray[depth - 1] ? '50%' : -1,
                      width: 1,
                      background: '#cbd5e1',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: (depth - 1) * 32 + 16 + 6,
                      top: '50%',
                      width: 26,
                      height: 1,
                      background: '#cbd5e1',
                    }}
                  />
                </>
              )}

              {/* 3. Line going down to children from THIS node (if it has children) */}
              {hasChildren && (
                <div
                  style={{
                    position: 'absolute',
                    left: depth * 32 + 16 + 5.5,
                    top: '50%',
                    bottom: -1,
                    width: 1,
                    background: '#cbd5e1',
                  }}
                />
              )}

              {/* 4. The circle for current node */}
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  marginRight: 12,
                  zIndex: 1,
                  flexShrink: 0,
                }}
              />

              <span style={{ color: '#0062ff', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                {location.name}
                {depth === 0 && <Star size={14} fill="#eab308" color="#eab308" />}
              </span>
            </div>
          </td>
          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
            {location.type}
          </td>
          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13 }}>
            {[location.city, location.state, location.country].filter(Boolean).join(' ') || '-'}
          </td>
          <td style={{ padding: '12px 16px', color: '#333', fontSize: 13, textAlign: 'right' }}>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => navigate(`/organizations/${orgId}/settings/locations/${location.id}/edit`)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                title="Edit Location"
              >
                <Edit2 size={16} />
              </button>
              <button
                onClick={() => setLocationToDelete(location.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e54d4d' }}
                title="Delete Location"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </td>
        </tr>
        {hasChildren && children.map((child, index) => renderLocationRow(child, depth + 1, [...isLastArray, index === children.length - 1]))}
      </Fragment>
    );
  };

  const headerStyle = {
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 11,
    color: '#64748b',
    textTransform: 'uppercase' as const,
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          background: '#fff',
          borderBottom: '1px solid #eef0f3',
        }}
      >
        <h1 style={{ fontSize: '18px', fontWeight: 600, color: '#000', margin: 0 }}>
          Locations
        </h1>
        <button
          onClick={() => navigate(`/organizations/${orgId}/settings/locations/new`)}
          style={{
            background: '#186337',
            color: 'white',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            fontWeight: 500,
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Plus size={16} /> New
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
            Loading locations...
          </div>
        ) : locations.length === 0 ? (
          <div style={{ padding: '64px 32px', textAlign: 'center' }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: '#1e293b', margin: '0 0 8px 0' }}>
              No Locations Yet
            </h2>
            <p style={{ color: '#64748b', marginBottom: 24 }}>
              Add a new location to start tracking operations in different places.
            </p>
            <button
              onClick={() => navigate(`/organizations/${orgId}/settings/locations/new`)}
              style={{
                background: '#0062ff',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                fontWeight: 500,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Add Location
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid #eef0f3' }}>
                <th style={headerStyle}>NAME</th>
                <th style={headerStyle}>TYPE</th>
                <th style={headerStyle}>ADDRESS DETAILS</th>
                <th style={{ ...headerStyle, textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {rootLocations.map((loc) => renderLocationRow(loc, 0))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!locationToDelete}
        title="Delete Location"
        message="Are you sure you want to delete this location? This action cannot be undone."
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        onConfirm={() => {
          if (locationToDelete) deleteMutation.mutate(locationToDelete);
        }}
        onCancel={() => setLocationToDelete(null)}
      />
    </div>
  );
}
