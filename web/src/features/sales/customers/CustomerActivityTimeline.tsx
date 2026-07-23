import { format } from 'date-fns';

import { type CustomerActivity } from './customers.schemas';
import { MessageSquare } from 'lucide-react';
import './CustomerActivityTimeline.css';

interface CustomerActivityTimelineProps {
  activities: CustomerActivity[];
  isLoading?: boolean;
}

export function CustomerActivityTimeline({ activities, isLoading }: CustomerActivityTimelineProps) {
  if (isLoading) {
    return <div className="timeline-loading">Loading activities...</div>;
  }

  if (!activities || activities.length === 0) {
    return <div className="timeline-empty">No activities recorded yet.</div>;
  }

  return (
    <div className="customer-timeline">
      {activities.map((activity) => (
        <div key={activity.id} className="timeline-item">
          <div className="timeline-time">
            <span className="timeline-date">{format(new Date(activity.createdAt), 'dd-MM-yyyy')}</span>
            <span>{format(new Date(activity.createdAt), 'hh:mm a')}</span>
          </div>
          <div className="timeline-line"></div>
          <div className="timeline-icon">
            <MessageSquare size={12} />
          </div>
          <div className="timeline-content">
            <div className="timeline-card">
              <h4>{activity.title}</h4>
              {activity.description && <p>{activity.description}</p>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
