import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { PER_PAGE_OPTIONS, type PageContext } from '../../lib/pagination';
import { Select } from './Select';

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
  hideTotal,
  hidePerPage,
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
  hideTotal?: boolean;
  hidePerPage?: boolean;
}) {
  if (!pageContext) return null;

  const canPrev = page > 1;
  const canNext = pageContext.hasMore;

  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end = total !== undefined ? Math.min(page * perPage, total) : page * perPage;

  return (
    <div 
      className="pagination-bar" 
      style={{ 
        display: 'flex', 
        flexDirection: 'row', 
        flexWrap: 'wrap',
        gap: '8px', 
        padding: '6px 16px',
        minHeight: '44px',
        height: 'auto',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}
    >
      <div style={{ display: 'flex', flex: 1, minWidth: '100px', alignItems: 'center' }}>
        {!hideTotal && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Total Count:</span>
            {isCounting ? (
              <span style={{ color: 'var(--color-text-subtle)' }}>loading…</span>
            ) : total !== undefined ? (
              <span style={{ fontWeight: 500, color: 'var(--color-text)' }}>{total}</span>
            ) : (
              <button
                type="button"
                onClick={onRequestCount}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  fontWeight: 500,
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                View
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div 
          style={{ 
            display: 'inline-flex', 
            border: '1px solid #cbd5e1', 
            borderRadius: '6px', 
            overflow: 'hidden',
            height: '32px'
          }}
        >
          {/* Left section: Per Page Selector */}
          {!hidePerPage && (
            <div 
              style={{ 
                background: '#f8fafc', 
                borderRight: '1px solid #cbd5e1',
                display: 'flex', 
                alignItems: 'center', 
                padding: '0 4px 0 8px',
                gap: '2px'
              }}
            >
              <Settings size={14} color="#64748b" style={{ flexShrink: 0 }} />
              <Select
                value={String(perPage)}
                onChange={(v) => onPerPageChange(Number(v))}
                options={PER_PAGE_OPTIONS.map((n) => ({ value: String(n), label: `${n} per page` }))}
                minWidth={95}
                fullWidth={false}
                dropUp
                hideIcon={true}
                ariaLabel="Rows per page"
                buttonStyle={{
                  border: 'none',
                  background: 'transparent',
                  padding: '0 4px',
                  height: '100%',
                  color: '#475569',
                  fontWeight: 400
                }}
              />
            </div>
          )}

          {/* Right section: Navigation */}
          <div 
            style={{ 
              background: '#ffffff', 
              display: 'flex', 
              alignItems: 'center', 
              padding: '0 12px',
              gap: '12px'
            }}
          >
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={!canPrev}
              title="Previous page"
              aria-label="Previous page"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                cursor: canPrev ? 'pointer' : 'default',
                color: canPrev ? '#3b82f6' : '#cbd5e1',
                padding: 0,
              }}
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>
            
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap' }}>
              {start} - {end}
            </span>

            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={!canNext}
              title="Next page"
              aria-label="Next page"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                cursor: canNext ? 'pointer' : 'default',
                color: canNext ? '#3b82f6' : '#cbd5e1',
                padding: 0,
              }}
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
