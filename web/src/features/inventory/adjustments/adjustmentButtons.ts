/**
 * The buttons on the adjustment screens, in the same shapes the rest of the app
 * uses — the blue Save / white Cancel of a form footer (`CreateAssemblyPage`),
 * and the bordered buttons of a detail header (`ItemDetail`, `AssemblyDetail`).
 */

/** A form footer's main action: Save, Adjust. */
export const formPrimaryButton = (busy: boolean): React.CSSProperties => ({
  padding: '6px 20px',
  background: '#0062ff',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: busy ? 'not-allowed' : 'pointer',
  fontWeight: 500,
  fontSize: 13,
  opacity: busy ? 0.7 : 1,
});

/** A form footer's other actions: Save as Draft, Cancel. */
export const formSecondaryButton = (busy: boolean): React.CSSProperties => ({
  padding: '6px 20px',
  background: 'white',
  color: busy ? '#94a3b8' : '#333',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  cursor: busy ? 'not-allowed' : 'pointer',
  fontWeight: 500,
  fontSize: 13,
});

/** A button in a detail pane's header. */
export const headerButton = (
  tone: 'primary' | 'plain' | 'danger',
  busy = false,
): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 12px',
  border: tone === 'primary' ? '1px solid #0062ff' : '1px solid var(--color-border)',
  background: tone === 'primary' ? '#0062ff' : '#f8fafc',
  color: tone === 'primary' ? '#fff' : tone === 'danger' ? '#dc2626' : 'var(--color-text)',
  borderRadius: 4,
  fontSize: 13,
  fontWeight: tone === 'primary' ? 500 : 400,
  cursor: busy ? 'not-allowed' : 'pointer',
  opacity: busy ? 0.7 : 1,
});
