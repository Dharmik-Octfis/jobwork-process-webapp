import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';
import { notify } from '../../../lib/notify';
import type { StockAdjustmentDetail } from './adjustments.schemas';

/** Say what a save or an Adjust actually ended as — it is not always "adjusted". */
export function announceOutcome(adjustment: StockAdjustmentDetail): void {
  const number = adjustment.adjustmentNumber;
  if (adjustment.status === 'adjusted') notify.success(`Stock adjusted — ${number}.`);
  else if (adjustment.status === 'pending_approval') {
    notify.success(`${number} sent for approval. Stock moves once it is approved.`);
  } else notify.success(`Draft saved — ${number}.`);
}

/**
 * Every figure the touched items show is cached; a stale one reads as "the
 * adjustment did nothing". Harmless after a draft, which moved no stock.
 */
export function refreshAfterAdjustment(queryClient: QueryClient, itemIds: readonly string[]): void {
  void queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      itemIds.some((itemId) => queryKey.includes(itemId)) ||
      [
        'items',
        'availableBatches',
        'available-batches',
        'stockAdjustments',
        'stockAdjustment',
        'stockAdjustments-count',
        'adjustment-stock',
        'adjustment-values',
        'record-approvals',
        // A reason an adjustment now carries can no longer be deleted.
        'adjustment-reasons',
      ].includes(String(queryKey[0])),
  });
}

/** The fields the server's refusal named, for red borders. The toast is app/queryClient.ts's. */
export function reportSaveError(error: unknown): string[] {
  if (!axios.isAxiosError(error)) return [];
  const details = (error.response?.data as { details?: Record<string, unknown> })?.details;
  return details ? Object.keys(details) : [];
}

/** The server's `customFields.<key>` messages, as `CustomFieldsSection` takes them. */
export function customFieldErrorsOf(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};
  const details = (error.response?.data as { details?: Record<string, unknown> })?.details ?? {};
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => key.startsWith('customFields.'))
      .map(([key, message]) => [key, String(message)]),
  );
}
