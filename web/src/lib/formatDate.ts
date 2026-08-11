import { format } from 'date-fns';

export function formatDate(dateString: string | Date | undefined | null): string {
  if (!dateString) return '-';
  return format(new Date(dateString), 'dd-MM-yyyy');
}
