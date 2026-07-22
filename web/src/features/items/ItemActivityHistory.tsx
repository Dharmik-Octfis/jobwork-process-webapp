interface Activity {
  id: string;
  title: string;
  description: string;
  performedBy: string | null;
  createdAt: string;
}

interface ItemActivityHistoryProps {
  activities: Activity[];
  isLoading: boolean;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;

  return `${day}-${month}-${year} ${strTime}`;
}

export function ItemActivityHistory({ activities, isLoading }: ItemActivityHistoryProps) {
  if (isLoading) {
    return <div style={{ padding: '24px', color: '#64748b' }}>Loading history...</div>;
  }

  if (!activities || activities.length === 0) {
    return <div style={{ padding: '24px', color: '#64748b' }}>No activity history found.</div>;
  }

  return (
    <div style={{ padding: '0 24px 24px 24px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #eef0f3' }}>
            <th
              style={{
                padding: '12px 16px',
                color: '#64748b',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                width: '220px',
              }}
            >
              Date
            </th>
            <th
              style={{
                padding: '12px 16px',
                color: '#64748b',
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => (
            <tr key={activity.id} style={{ borderBottom: '1px solid #eef0f3' }}>
              <td
                style={{
                  padding: '8px 16px',
                  color: '#475569',
                  fontSize: '13px',
                  verticalAlign: 'top',
                }}
              >
                {formatDate(activity.createdAt)}
              </td>
              <td
                style={{
                  padding: '8px 16px',
                  color: '#333',
                  fontSize: '13px',
                  verticalAlign: 'top',
                }}
              >
                <span style={{ fontWeight: 500 }}>{activity.description}</span>
                {activity.performedBy && (
                  <span style={{ color: '#64748b', marginLeft: '4px', fontSize: '13px' }}>
                    by - {activity.performedBy}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
