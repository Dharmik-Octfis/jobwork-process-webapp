import { ArrowLeft } from 'lucide-react';

interface Props {
  onClick: () => void;
  /** Names the destination, not the icon — "Back" alone tells a screen-reader
   * user nothing about where they are about to land. */
  label: string;
}

/**
 * The back control on a full-page form.
 *
 * One component rather than a styled `<ArrowLeft>` per page: a create/edit page
 * whose only way out is the Cancel button at the FOOT of the form leaves anyone
 * who has scrolled with no visible exit, and six hand-rolled copies of this is
 * how one of them ends up as a `<div onClick>` that Tab walks straight past
 * (CLAUDE.md).
 *
 * It is a real `<button type="button">`, so it is focusable, fires on Enter and
 * Space, and keeps its focus ring for free.
 */
export function BackButton({ onClick, label }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        border: '1px solid #e2e8f0',
        borderRadius: 4,
        background: '#fff',
        cursor: 'pointer',
        color: '#64748b',
        flexShrink: 0,
      }}
    >
      <ArrowLeft size={15} />
    </button>
  );
}
