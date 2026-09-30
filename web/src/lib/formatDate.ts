import { format } from 'date-fns';

export function formatDate(dateString: string | Date | undefined | null): string {
  if (!dateString) return '-';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return format(d, 'dd-MM-yyyy');
  } catch {
    return String(dateString);
  }
}
