import { toast } from 'react-hot-toast';

/**
 * The only way to show a toast. One toast per kind is on screen at a time: each
 * kind has a fixed id, so a second call replaces the first in place instead of
 * stacking beside it.
 *
 * That is what keeps one save to one toast. A mutation's message is announced
 * twice by design — the API client toasts the server's envelope message, then
 * the screen's `onSuccess` may say something more specific — and React Query
 * runs the screen's callback last, so the specific message is the one left.
 * Errors work the same way with `app/queryClient.ts`'s global `onError`.
 */
const IDS = {
  success: 'notify-success',
  error: 'notify-error',
  warning: 'notify-warning',
  info: 'notify-info',
};

export const notify = {
  success: (message: string) => toast.success(message, { id: IDS.success }),
  error: (message: string) => toast.error(message, { id: IDS.error }),
  // Separate id: a plan warning must survive the success toast of the same save.
  warning: (message: string) => toast(message, { id: IDS.warning, icon: '⚠️', duration: 8000 }),
  info: (message: string) => toast(message, { id: IDS.info, icon: 'ℹ️', duration: 4000 }),
};
