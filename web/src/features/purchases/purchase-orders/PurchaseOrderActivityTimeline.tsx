import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { fetchPurchaseOrderActivities } from './purchase-orders.api';

interface PurchaseOrderActivityTimelineProps {
  orgId: string;
  poId: string;
}

export function PurchaseOrderActivityTimeline({ orgId, poId }: PurchaseOrderActivityTimelineProps) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['po-activities', orgId, poId],
    queryFn: () => fetchPurchaseOrderActivities(orgId, poId),
    enabled: Boolean(orgId && poId),
  });

  if (isLoading) {
    return (
      <div style={{ padding: '24px', color: '#64748b', textAlign: 'center' }}>
        Loading activity history...
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div style={{ padding: '24px', color: '#64748b', textAlign: 'center' }}>
        No activity history recorded yet.
      </div>
    );
  }

  return (
    <div style={{ padding: '0', width: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <th
              style={{
                padding: '12px 16px',
                color: '#475569',
                fontSize: '11.5px',
                fontWeight: 600,
                textTransform: 'uppercase',
                width: '220px',
                letterSpacing: '0.04em',
              }}
            >
              DATE
            </th>
            <th
              style={{
                padding: '12px 16px',
                color: '#475569',
                fontSize: '11.5px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              DETAILS
            </th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => {
            const formattedDate = format(new Date(activity.createdAt), 'dd-MM-yyyy hh:mm a');
            const titleText = activity.title || activity.description || 'Activity recorded';
            const userDisplayName = activity.performedBy
              ? activity.performedBy.replace(/\s*\(User\)$/i, '')
              : null;

            return (
              <tr
                key={activity.id}
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td
                  style={{
                    padding: '14px 16px',
                    color: '#475569',
                    fontSize: '13px',
                    verticalAlign: 'middle',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formattedDate}
                </td>
                <td
                  style={{
                    padding: '14px 16px',
                    color: '#334155',
                    fontSize: '13px',
                    verticalAlign: 'middle',
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>
                    {titleText.endsWith('.') ? titleText : `${titleText}.`}
                  </span>
                  {userDisplayName && (
                    <span style={{ color: '#64748b', marginLeft: '6px' }}>
                      by -{' '}
                      <span style={{ color: '#0284c7', fontWeight: 500, cursor: 'pointer' }}>
                        {userDisplayName}
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
