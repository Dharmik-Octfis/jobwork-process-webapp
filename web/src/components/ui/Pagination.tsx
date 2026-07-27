import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PER_PAGE_OPTIONS, type PageContext } from '../../lib/pagination';
import { Select } from './Select';

/** Control height shared by the page-size select and the nav buttons. */
const CONTROL_HEIGHT = 30;

const navBtnStyle = (disabled: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: CONTROL_HEIGHT,
  height: CONTROL_HEIGHT,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: disabled ? 'var(--color-surface-2)' : 'var(--color-surface)',
  cursor: disabled ? 'default' : 'pointer',
  color: disabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
});

/**
 * The list pagination bar: page size, previous/next, and an opt-in total.
 *
 * There is no first/last jump on purpose — "last" needs the total row count, and
 * the whole point of the on-demand count is that a list request never pays for a
 * COUNT(*). Prev/next work from `hasMore`, which costs nothing.
 */
export function Pagination({
  pageContext,
  page,
  onPageChange,
  perPage,
  onPerPageChange,
  total,
  isCounting,
  onRequestCount,
}: {
  pageContext: PageContext | undefined;
  page: number;
  onPageChange: (page: number) => void;
  perPage: number;
  onPerPageChange: (perPage: number) => void;
  /** Undefined until the user asks for it. */
  total?: number;
  isCounting?: boolean;
  onRequestCount: () => void;
}) {
  if (!pageContext) return null;

  const canPrev = page > 1;
  const canNext = pageContext.hasMore;

  return (
    <div
      style={{
        height: '44px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '0 20px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        fontSize: 13,
        color: 'var(--color-text-muted)',
      }}
    >
      {/* Total count — computed only when asked for. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Total count:</span>
        {isCounting ? (
          <span>loading…</span>
        ) : total !== undefined ? (
          <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{total}</span>
        ) : (
          <button
            onClick={onRequestCount}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              fontWeight: 500,
              color: 'var(--color-primary)',
              cursor: 'pointer',
            }}
          >
            View
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Select
            value={String(perPage)}
            onChange={(v) => onPerPageChange(Number(v))}
            options={PER_PAGE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
            minWidth={78}
            fullWidth={false}
            // The bar sits at the bottom of a container that clips its overflow,
            // so the list has to open upward or it is never visible.
            dropUp
            ariaLabel="Rows per page"
          />
          <span>per page</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Page {pageContext.page}</span>
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={!canPrev}
            title="Previous page"
            aria-label="Previous page"
            style={navBtnStyle(!canPrev)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!canNext}
            title="Next page"
            aria-label="Next page"
            style={navBtnStyle(!canNext)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
