import { formatDate } from '../../lib/formatDate';
import type { CustomFieldDefinition } from './customFields.schemas';

/**
 * How a stored custom-field value reads on screen — one answer for every list
 * cell and detail row, because the blob does not carry its own type.
 *
 * The engine stores the *machine* form: select values are option **ids**, so a
 * bare `String(value)` prints `opt_7f3a91c2` where the user picked "Cotton".
 * Without the definition (an archived field, a stale saved column) there is
 * nothing to decode with, and it falls back to that raw form.
 */
export function formatCustomFieldValue(value: unknown, def?: CustomFieldDefinition): string {
  if (value === null || value === undefined || value === '') return '-';

  switch (def?.dataType) {
    case 'select':
    case 'multi_select': {
      const options = def.config?.options ?? [];
      const label = (v: unknown) => options.find((o) => o.id === v)?.label ?? String(v);
      if (!Array.isArray(value)) return label(value);
      return value.length ? value.map(label).join(', ') : '-';
    }

    // 🔴 Split, not parsed. `date` is stored as `YYYY-MM-DD` (engine: `z.iso.date`),
    // and `new Date('2026-08-12')` is UTC midnight, which renders as the 11th
    // anywhere behind UTC.
    case 'date': {
      const [y, m, d] = String(value).slice(0, 10).split('-');
      return y && m && d ? `${d}-${m}-${y}` : String(value);
    }

    // `datetime` carries an offset, so it is a real instant and parses safely.
    case 'datetime': {
      const at = new Date(String(value));
      if (Number.isNaN(at.getTime())) return String(value);
      const hh = String(at.getHours()).padStart(2, '0');
      const mm = String(at.getMinutes()).padStart(2, '0');
      return `${formatDate(at)} ${hh}:${mm}`;
    }

    // `HH:MM` already — no date to reformat.
    case 'time':
      return String(value);

    case 'checkbox':
      return value ? 'Yes' : 'No';

    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}
