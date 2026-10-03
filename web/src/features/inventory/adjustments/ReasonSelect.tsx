import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';
import { SearchableSelect } from '../../../components/ui/SearchableSelect';
import { fetchReasons } from './adjustments.api';
import { reasonsQueryKey } from './adjustments.schemas';
import { ManageReasonsModal } from './ManageReasonsModal';

interface ReasonSelectProps {
  orgId: string;
  value: string;
  onChange: (reasonId: string) => void;
  hasError?: boolean;
}

/** The org's active reasons, plus "Manage Reasons" to add, deactivate or delete them. */
export function ReasonSelect({ orgId, value, onChange, hasError }: ReasonSelectProps) {
  const [isManaging, setIsManaging] = useState(false);
  const { data: reasons = [] } = useQuery({
    queryKey: reasonsQueryKey(orgId),
    queryFn: () => fetchReasons(orgId),
  });

  // An inactive reason is not offered — unless this document already carries it.
  const options = reasons
    .filter((reason) => reason.isActive || reason.id === value)
    .map((reason) => ({
      value: reason.id,
      label: reason.isActive ? reason.name : `${reason.name} (inactive)`,
    }));

  return (
    <>
      <SearchableSelect
        options={options}
        value={value || undefined}
        onChange={onChange}
        placeholder="Select a reason…"
        hasError={hasError}
        footerAction={{
          text: 'Manage Reasons',
          icon: <Settings size={14} />,
          onClick: () => setIsManaging(true),
        }}
        portal
      />
      <ManageReasonsModal
        orgId={orgId}
        isOpen={isManaging}
        onClose={() => setIsManaging(false)}
        onSelect={(reasonId) => {
          onChange(reasonId);
          setIsManaging(false);
        }}
      />
    </>
  );
}
