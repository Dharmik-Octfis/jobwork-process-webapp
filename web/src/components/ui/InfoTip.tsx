import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import styles from './InfoTip.module.css';

const TIP_WIDTH = 240;
const VIEWPORT_GUTTER = 16;

/**
 * An info icon that shows a short explanation on click, tap or Enter — never
 * hover alone, which a phone does not have (CLAUDE.md: field messages stay short,
 * longer help lives behind an icon).
 *
 * 🔴 Always portalled and `fixed`: it sits in grid captions that also render
 * inside a `Modal`, whose scrolling body would clip an absolute bubble.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return undefined;
    // `window` capture runs before `Modal`'s `document` listener, so one Escape
    // closes the tip and not the dialog behind it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Capture-phase scroll: the scroller is often a dialog body, and scroll does not bubble.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = buttonRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(TIP_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - width / 2, VIEWPORT_GUTTER),
        window.innerWidth - VIEWPORT_GUTTER - width,
      );
      const height = tipRef.current?.offsetHeight ?? 0;
      const openUp = window.innerHeight - rect.bottom < height + 16 && rect.top > height + 16;
      setPosition({
        left,
        width,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? tipId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div ref={tipRef} id={tipId} role="tooltip" className={styles.tip} style={position}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
