import type { PageContext } from '../../lib/pagination';

const btnStyle = (disabled: boolean) => ({
  padding: '5px 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  background: '#fff',
  fontSize: 13,
  cursor: disabled ? 'default' : 'pointer',
  color: disabled ? '#cbd5e1' : '#334155',
});

/**
 * Prev/Next pager shared by every list. Renders nothing when there's only one
 * page (no `hasMore` and already on page 1).
 */
export function Pagination({
  pageContext,
  page,
  onPageChange,
}: {
  pageContext: PageContext | undefined;
  page: number;
  onPageChange: (page: number) => void;
}) {
  if (!pageContext || (!pageContext.hasMore && page <= 1)) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
        padding: '10px 24px',
        borderTop: '1px solid #eef0f3',
        background: '#fff',
        fontSize: 13,
        color: '#64748b',
      }}
    >
      <span>
        Page {pageContext.page} · {pageContext.total} total
      </span>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        style={btnStyle(page <= 1)}
      >
        Previous
      </button>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={!pageContext.hasMore}
        style={btnStyle(!pageContext.hasMore)}
      >
        Next
      </button>
    </div>
  );
}
