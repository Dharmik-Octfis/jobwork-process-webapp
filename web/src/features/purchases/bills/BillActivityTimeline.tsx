import { format } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { fetchBillActivities } from './bills.api';

interface BillActivityTimelineProps {
  orgId: string;
  poId: string;
}

export function BillActivityTimeline({ orgId, poId }: BillActivityTimelineProps) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['po-activities', orgId, poId],
    queryFn: () => fetchBillActivities(orgId, poId),
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
          <tr style={{ borderBottom: '1px solid #eef0f3' }}>
            <th
              style={{
                padding: '12px 16px',
                color: '#64748b',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                width: '220px',
                letterSpacing: '0.5px',
              }}
            >
              DATE
            </th>
            <th
              style={{
                padding: '12px 16px',
                color: '#64748b',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
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
              <tr key={activity.id} style={{ borderBottom: '1px solid #eef0f3' }}>
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
                  {activity.performedBy && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                      by {activity.performedBy} -{' '}
                      <span style={{ color: '#60a5fa', cursor: 'pointer' }}>{userDisplayName}</span>
                    </div>
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
