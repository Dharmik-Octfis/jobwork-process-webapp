import { Plus } from 'lucide-react';

interface NewButtonProps {
  onClick: () => void;
  /** Defaults to "New" — the list page's create action. */
  label?: string;
}

/** A list page's "+ New" — green, the same on every module (docs/UI_UX_PRINCIPLES.md §3). */
export function NewButton({ onClick, label = 'New' }: NewButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'var(--color-create)',
        color: 'white',
        border: 'none',
        padding: '6px 12px',
        borderRadius: 4,
        fontWeight: 500,
        fontSize: 13,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <Plus size={16} /> {label}
    </button>
  );
}
