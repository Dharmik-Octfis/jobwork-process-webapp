import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  /** One line under the title. Use it for the thing the user cannot change and
   * would otherwise ask about — "Dyeing destroys the packaging, so…". */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** The sticky action bar. Rendered outside the scrolling body so Save never
   * scrolls off a long grid. */
  footer?: ReactNode;
  width?: number | string;
  position?: 'center' | 'right';
}

/**
 * A dialog that is actually usable from a keyboard.
 *
 * 🔴 THIS EXISTS BECAUSE OF CLAUDE.md's TAB RULE, and every part of it is one of
 * that rule's four requirements — none is decoration:
 *
 *   1. FOCUS IS TAKEN on open. Without it the first Tab goes to the browser
 *      chrome, and someone on a keyboard has no idea the dialog is even there.
 *   2. FOCUS IS TRAPPED while open. Without the trap, Tab walks straight out of
 *      the dialog and into the page behind it — which is still there, still
 *      focusable, and now unreachable by mouse because the overlay covers it.
 *   3. ESC CLOSES. The one shortcut everybody tries first.
 *   4. FOCUS RETURNS to whatever opened it. Otherwise closing a dialog dumps
 *      focus at the top of the document and the user has to Tab back through the
 *      whole page to get where they were.
 *
 * None of this is visible in a screenshot and none of it fails `tsc -b`. It is
 * the exact class of defect the rule was written for: the dialog looks perfect
 * and half the users cannot operate it.
 *
 * `ConfirmDialog` deliberately stays as it is — it holds two buttons and its own
 * CSS module, and rewriting it to route through this would be a change with no
 * user-visible benefit. This is for dialogs that contain a form or a grid.
 */

/**
 * 🔴 WHICH DIALOG IS ON TOP, when one opens over another.
 *
 * Every open Modal listens for Escape on `document` in the CAPTURE phase, and
 * `stopPropagation` does not stop a second listener on the same node — that needs
 * `stopImmediatePropagation`, and even then the OUTER dialog registered first, so
 * it would be the one to win and the wrong one would close. Without this stack,
 * one Escape over the Issue dialog's "Add stock" popup closed both of them and
 * threw away a half-filled challan.
 *
 * A module-level array rather than context: nesting is rare, the only question is
 * "am I last", and a provider every caller has to remember to mount is a trap of
 * exactly the kind this file exists to close.
 */
const modalStack: symbol[] = [];
export function Modal({
  isOpen,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 900,
  position = 'center',
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Captured on open, restored on close — see requirement 4.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Stable across renders, so this instance keeps its place in the stack.
  const idRef = useRef<symbol>(Symbol('modal'));
  /**
   * 🔴 THE EFFECT BELOW MUST RUN ONCE PER OPEN, NOT ONCE PER RENDER.
   *
   * Nearly every caller passes an inline `onClose={() => setThing(null)}`, which
   * is a new function on each of the PARENT's renders — so depending on it re-ran
   * the whole effect whenever anything upstream re-rendered. Two things broke:
   * the dialog re-took focus mid-typing, and, once dialogs could nest, an outer
   * one re-pushed itself onto the stack ABOVE the popup covering it, so Escape
   * closed the wrong dialog. Reading the latest handler out of a ref keeps the
   * effect keyed on `isOpen` alone.
   */
  const onCloseRef = useRef(onClose);
  // Its own effect, not an assignment during render — writing a ref while
  // rendering is what `react-hooks/refs` forbids, and it is forbidden for a
  // reason under concurrent rendering.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const id = idRef.current;
    modalStack.push(id);
    const isTopmost = () => modalStack[modalStack.length - 1] === id;

    returnFocusRef.current = document.activeElement as HTMLElement | null;

    // Requirement 1. The first real control, or the dialog itself when it has
    // none yet (a grid still loading) — never nothing.
    const focusFirst = () => {
      const node = dialogRef.current;
      if (!node) return;
      const target = node.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (target ?? node).focus();
    };
    // After paint: the children are rendered by the same commit, so querying
    // synchronously here finds an empty dialog.
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog with another one open over it is inert: Escape belongs to the
      // top one, and so does Tab — trapping focus into a covered dialog would
      // drag it out of the one the user is actually looking at.
      if (!isTopmost()) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      // Requirement 2. Re-queried on every Tab rather than cached: rows appear
      // and disappear in these dialogs as batches are expanded, and a cached list
      // would trap focus on elements that no longer exist.
      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    // The page behind must not scroll under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      const at = modalStack.lastIndexOf(id);
      if (at !== -1) modalStack.splice(at, 1);
      // Only the last dialog to close gives the page its scrollbar back — an
      // inner one closing must leave the outer one's lock in place.
      if (modalStack.length === 0) document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: position === 'right' ? 'center' : 'flex-start',
        justifyContent: position === 'right' ? 'flex-end' : 'center',
        padding: position === 'right' ? '16px' : '40px 16px',
        zIndex: 1100,
      }}
      // Clicking the backdrop closes; clicking inside must not bubble up to it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: '#fff',
          borderRadius: position === 'right' ? 8 : 6,
          width: '100%',
          maxWidth: width,
          boxShadow: '0 12px 40px rgba(15, 23, 42, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: position === 'right' ? 'calc(100vh - 32px)' : 'calc(100vh - 80px)',
          height: position === 'right' ? 'calc(100vh - 32px)' : undefined,
          outline: 'none',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            padding: '16px 20px',
            borderBottom: '1px solid #eef0f3',
          }}
        >
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111', margin: 0 }}>{title}</h2>
            {subtitle && (
              <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0', lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
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
            <X size={15} />
          </button>
        </header>

        {/*
          🔴 `scrollbar-gutter: stable` is load-bearing, not polish.

          A dropdown inside the body is absolutely positioned, and an out-of-flow
          child still extends its scroll container's OVERFLOW REGION — so opening
          one made this body scrollable, the scrollbar took ~15px of width, and any
          `repeat(auto-fit, minmax(…))` grid inside lost a column and grew a row.
          The whole dialog visibly resized when you opened the Processor dropdown.

          Reserving the gutter up front means the content width never changes, so
          nothing reflows. This is what the property exists for; the alternative is
          every dialog's layout being one dropdown away from moving.
        */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarGutter: 'stable',
            padding: '16px 20px',
          }}
        >
          {children}
        </div>

        {footer && (
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 20px',
              borderTop: '1px solid #eef0f3',
              background: '#fff',
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
