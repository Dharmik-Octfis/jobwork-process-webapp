import { format } from 'date-fns';

export function formatDate(dateString: string | Date | undefined | null): string {
  if (!dateString) return '';
  try {
    const d = typeof dateString === 'string' || typeof dateString === 'number' ? new Date(dateString) : dateString;
    if (isNaN(d.getTime())) return String(dateString);
    return format(d, 'dd-MM-yyyy');
  } catch {
    return String(dateString);
  }
}
