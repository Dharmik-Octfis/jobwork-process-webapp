import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addDays,
  addMonths,
  addYears,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/**
 * A date field that reads and types `DD-MM-YYYY` everywhere, on every machine.
 *
 * 🔴 THIS EXISTS BECAUSE `<input type="date">` CANNOT BE FORMATTED. The native
 * control renders in the *browser's* locale — `08/21/2026` on a US-configured
 * machine, `2026/08/21` on a Japanese one — and no attribute, CSS property or
 * script changes that. Every other date in the app is `dd-MM-yyyy` (see
 * `lib/formatDate.ts`), so the one place a date is typed was the one place it
 * disagreed with the rest of the screen.
 *
 * 🔴 THE VALUE CONTRACT IS UNCHANGED: `value` and `onChange` speak `yyyy-MM-dd`,
 * exactly what the native input emitted. Only the *rendering* differs, so a call
 * site swaps the element and touches neither its state nor its payload.
 *
 * Dates are parsed and formatted through their **local** parts — never
 * `new Date('2026-08-21')`, which is UTC midnight and lands on the 20th anywhere
 * behind UTC. That bug is why `formatCustomFieldValue` splits its date strings.
 */

/** Above `Modal`'s overlay (1100) — a portalled calendar is a sibling of it. */
const PORTAL_Z_INDEX = 1200;
const CALENDAR_WIDTH = 252;
/** Below this much room under the anchor, the calendar opens upwards instead. */
const CALENDAR_MIN_HEIGHT = 300;

const ISO = 'yyyy-MM-dd';
const DISPLAY = 'dd-MM-yyyy';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DateInput({
  value,
  onChange,
  id,
  disabled = false,
  hasError = false,
  min,
  max,
  placeholder = 'DD-MM-YYYY',
  ariaLabel,
  style,
  className,
  containerStyle,
  portal = false,
}: {
  /** `yyyy-MM-dd`, or `''`. Same as the native input it replaces. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  hasError?: boolean;
  /** `yyyy-MM-dd` bounds. Out-of-range days are disabled in the grid and refused
   * when typed, the way the native `min`/`max` attributes behaved. */
  min?: string;
  max?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Merged onto the input, so a caller keeps its own `inputStyle`. */
  style?: React.CSSProperties;
  /**
   * For call sites styled by a stylesheet rather than inline (`users-input`).
   * Passing one drops the inline look entirely — an inline border always beats a
   * class's, so emitting both would leave the field ignoring the sheet it was
   * given. Layout the button depends on still applies.
   */
  className?: string;
  containerStyle?: React.CSSProperties;
  /**
   * 🔴 REQUIRED WHENEVER THIS SITS INSIDE A `Modal` (CLAUDE.md) — same reason as
   * `Select`'s: the dialog body is a scroll container and the cards inside it clip
   * to their rounded corners, so an absolutely-positioned calendar opens *inside*
   * the section with most of it unreachable. Portalled, it is a fixed-position
   * sibling of the overlay, and it takes Escape off the dialog.
   */
  portal?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const activeDayRef = useRef<HTMLButtonElement>(null);

  const autoId = useId();
  const inputId = id ?? `${autoId}-date`;

  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState(() => displayFrom(value));
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(fromIso(value) ?? new Date()));
  const [activeDay, setActiveDay] = useState(() => fromIso(value) ?? new Date());
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });
  const [focused, setFocused] = useState(false);

  const borderColor = hasError ? '#ef4444' : focused ? '#2563eb' : '#d1d5db';
  const ringColor = hasError ? 'rgba(239, 68, 68, 0.18)' : 'rgba(37, 99, 235, 0.18)';

  const selected = fromIso(value);
  const minDate = fromIso(min ?? '');
  const maxDate = fromIso(max ?? '');

  /**
   * Re-render the text when the value moves underneath us — a form reset, a clone
   * blanking its dates, a parent deriving one date from another.
   *
   * Adjusted during render rather than in an effect: an effect would paint the
   * stale text first, and it is also the keystroke path (typing a complete date
   * calls `onChange`, which comes straight back as a new `value`), so the flicker
   * would be on every character of the year.
   */
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(displayFrom(value));
  }

  const open = () => {
    if (disabled) return;
    const start = clamp(selected ?? new Date(), minDate, maxDate);
    setViewMonth(startOfMonth(start));
    setActiveDay(start);
    setIsOpen(true);
  };

  const close = (refocus: boolean) => {
    setIsOpen(false);
    if (refocus) inputRef.current?.focus();
  };

  const commit = (day: Date) => {
    if (isBlocked(day, minDate, maxDate)) return;
    onChange(format(day, ISO));
    setText(format(day, DISPLAY));
    close(true);
  };

  /** `window` is ahead of `document` in the capture path, which is what lets this
   * stop Escape before the dialog behind it ever sees it — otherwise one Escape
   * over an open calendar closes the whole dialog and throws the form away. */
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      setIsOpen(false);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen]);

  /** A click anywhere else closes. `mousedown`, not `click`: a click that starts
   * on the page and ends on the calendar must not count as "inside". */
  useEffect(() => {
    if (!isOpen) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [isOpen]);

  /** Re-measured on scroll in the CAPTURE phase: the scrollers are the dialog body
   * and any grid inside it, and `scroll` does not bubble — a listener on `window`
   * never hears either and the calendar hangs in mid-air. */
  useLayoutEffect(() => {
    if (!portal || !isOpen) return undefined;
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      // Flip up only when below is genuinely too tight AND above is roomier —
      // otherwise a calendar near the bottom of a tall dialog flaps between the two.
      const openUp = below < CALENDAR_MIN_HEIGHT && above > below;
      setPosition({
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - CALENDAR_WIDTH - 8)),
        width: CALENDAR_WIDTH,
        ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [portal, isOpen]);

  /** Roving focus: the grid holds one tab stop, and moving the selection moves the
   * focus with it — which is also what scrolls the active day into view. */
  useEffect(() => {
    if (!isOpen) return;
    activeDayRef.current?.focus();
  }, [isOpen, activeDay]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // The native control opens its picker on Alt+Down; ArrowDown alone is the
    // ARIA date-picker convention. Both, so neither habit is wrong.
    if (event.key === 'ArrowDown' || (event.altKey && event.key === 'ArrowDown')) {
      event.preventDefault();
      open();
    }
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Tab leaves the calendar rather than cycling inside it: the popup is a
    // sibling of the dialog on `document.body`, so `Modal`'s focus trap cannot see
    // it, and trapping here would fight the trap that owns the page.
    if (event.key === 'Tab') {
      close(false);
      return;
    }
    // Shift turns a page into a year, which is how every other calendar behaves
    // and the only way to reach a birth year without clicking ‹‹ two hundred times.
    const next = ((): Date | null => {
      switch (event.key) {
        case 'ArrowLeft':
          return addDays(activeDay, -1);
        case 'ArrowRight':
          return addDays(activeDay, 1);
        case 'ArrowUp':
          return addDays(activeDay, -7);
        case 'ArrowDown':
          return addDays(activeDay, 7);
        case 'PageUp':
          return event.shiftKey ? addYears(activeDay, -1) : addMonths(activeDay, -1);
        case 'PageDown':
          return event.shiftKey ? addYears(activeDay, 1) : addMonths(activeDay, 1);
        case 'Home':
          return startOfWeek(activeDay, { weekStartsOn: 0 });
        case 'End':
          return addDays(startOfWeek(activeDay, { weekStartsOn: 0 }), 6);
        default:
          return null;
      }
    })();
    if (!next) return;
    event.preventDefault();
    moveTo(next);
  };

  /** The active day and the month on screen move together — always. Letting the
   * header scroll away from the active day strands the grid's only tab stop on an
   * unmounted button, and the arrows stop working with no visible cause. */
  const moveTo = (day: Date) => {
    setActiveDay(day);
    setViewMonth(startOfMonth(day));
  };

  /**
   * Digits in, `dd-MM-yyyy` out — the separators are placed for the user rather
   * than typed. Deleting never fights back: the grouping only ever joins the parts
   * that exist, so a backspace over a dash removes it and the next one removes a
   * digit.
   */
  const handleTyping = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    const next = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)]
      .filter(Boolean)
      .join('-');
    setText(next);

    if (next === '') {
      onChange('');
      return;
    }
    if (digits.length < 8) return;

    const parsed = parse(next, DISPLAY, new Date());
    // The round trip is the real validity check: date-fns rolls `31-02-2026` over
    // into March rather than rejecting it, and a rolled date formats differently
    // from what was typed.
    if (!isValid(parsed) || format(parsed, DISPLAY) !== next) return;
    if (isBlocked(parsed, minDate, maxDate)) return;
    onChange(format(parsed, ISO));
    moveTo(parsed);
  };

  const gridStart = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
  // Always six weeks, so switching month never changes the popup's height and
  // re-runs the flip-up measurement mid-interaction.
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  const calendar = (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Choose date"
      onKeyDown={onGridKeyDown}
      style={{
        ...(portal
          ? { position: 'fixed', zIndex: PORTAL_Z_INDEX, ...position }
          : {
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              width: CALENDAR_WIDTH,
              zIndex: 70,
            }),
        padding: 10,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
        <NavButton label="Previous year" onClick={() => moveTo(addYears(activeDay, -1))}>
          <ChevronLeft size={13} />
          <ChevronLeft size={13} style={{ marginLeft: -9 }} />
        </NavButton>
        <NavButton label="Previous month" onClick={() => moveTo(addMonths(activeDay, -1))}>
          <ChevronLeft size={14} />
        </NavButton>
        <div
          aria-live="polite"
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 12.5,
            fontWeight: 600,
            color: '#111',
          }}
        >
          {format(viewMonth, 'MMMM yyyy')}
        </div>
        <NavButton label="Next month" onClick={() => moveTo(addMonths(activeDay, 1))}>
          <ChevronRight size={14} />
        </NavButton>
        <NavButton label="Next year" onClick={() => moveTo(addYears(activeDay, 1))}>
          <ChevronRight size={13} />
          <ChevronRight size={13} style={{ marginLeft: -9 }} />
        </NavButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            aria-hidden="true"
            style={{
              padding: '2px 0',
              textAlign: 'center',
              fontSize: 10.5,
              fontWeight: 600,
              color: '#94a3b8',
            }}
          >
            {day}
          </div>
        ))}
        {days.map((day) => {
          const iso = format(day, ISO);
          const isActive = iso === format(activeDay, ISO);
          const isSelected = Boolean(selected) && iso === format(selected!, ISO);
          const isOutside = day.getMonth() !== viewMonth.getMonth();
          const blocked = isBlocked(day, minDate, maxDate);
          return (
            <button
              key={iso}
              ref={isActive ? activeDayRef : undefined}
              type="button"
              // One tab stop for the whole grid — arrows move within it.
              tabIndex={isActive ? 0 : -1}
              // `aria-disabled`, not `disabled`: a disabled button cannot take
              // focus, so an arrow key landing on an out-of-range day would strand
              // the grid's only tab stop and the calendar would stop responding.
              // `commit` refuses it either way.
              aria-disabled={blocked || undefined}
              aria-pressed={isSelected}
              aria-current={iso === format(today, ISO) ? 'date' : undefined}
              aria-label={format(day, 'd MMMM yyyy')}
              onClick={() => commit(day)}
              style={{
                height: 28,
                border: '1px solid transparent',
                borderRadius: 4,
                background: isSelected ? '#2563eb' : 'transparent',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: isSelected ? 600 : 400,
                color: blocked ? '#cbd5e1' : isSelected ? '#fff' : isOutside ? '#cbd5e1' : '#111',
                cursor: blocked ? 'not-allowed' : 'pointer',
                // Today reads as an outline, so it never competes with the filled
                // selection for "which one is chosen".
                ...(iso === format(today, ISO) && !isSelected
                  ? { borderColor: '#2563eb', fontWeight: 600 }
                  : {}),
              }}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 8,
          paddingTop: 8,
          borderTop: '1px solid #eef0f3',
        }}
      >
        <FooterButton
          onClick={() => commit(clamp(new Date(), minDate, maxDate))}
          disabled={isBlocked(new Date(), minDate, maxDate)}
        >
          Today
        </FooterButton>
        <FooterButton
          onClick={() => {
            onChange('');
            setText('');
            close(true);
          }}
        >
          Clear
        </FooterButton>
      </div>
    </div>
  );

  return (
    <div ref={anchorRef} style={{ position: 'relative', width: '100%', ...containerStyle }}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={hasError || undefined}
        className={className}
        onChange={(event) => handleTyping(event.target.value)}
        onKeyDown={onInputKeyDown}
        onFocus={() => setFocused(true)}
        // Anything half-typed reverts to the committed value, so the box never
        // sits showing `21-0` as though it meant something.
        onBlur={() => {
          setFocused(false);
          setText((current) => (isoFrom(current) === value ? current : displayFrom(value)));
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          ...(className
            ? {}
            : {
                padding: '6px 8px',
                fontFamily: 'inherit',
                fontSize: 13,
                border: `1px solid ${borderColor}`,
                borderRadius: 4,
                background: disabled ? '#f8fafc' : '#fff',
                minHeight: 32,
                // The focus ring CLAUDE.md requires. Inline styles cannot express
                // `:focus`, so it is state — and the UA outline is left in place
                // underneath rather than cleared, which is the same bug in a
                // harder-to-see form.
                ...(focused ? { boxShadow: `0 0 0 2px ${ringColor}` } : {}),
              }),
          ...style,
          // After the caller's style, not before: every call site passes its own
          // `padding` shorthand, which would otherwise reset this and run the text
          // under the calendar button.
          paddingRight: 32,
        }}
      />
      <button
        type="button"
        // -1 like `Input`'s password toggle: the field itself is the tab stop, and
        // ArrowDown on it opens this. A second stop per date field would double the
        // Tab count of every form for a shortcut the input already has.
        tabIndex={-1}
        disabled={disabled}
        aria-label="Open calendar"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close(true) : open())}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: '#64748b',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Calendar size={14} />
      </button>

      {isOpen && (portal ? createPortal(calendar, document.body) : calendar)}
    </div>
  );
}

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      tabIndex={-1}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        padding: 0,
        border: '1px solid #e2e8f0',
        borderRadius: 4,
        background: '#fff',
        color: '#475569',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function FooterButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tabIndex={-1}
      style={{
        flex: 1,
        padding: '5px 0',
        border: '1px solid #e2e8f0',
        borderRadius: 4,
        background: '#fff',
        fontFamily: 'inherit',
        fontSize: 12,
        color: disabled ? '#cbd5e1' : '#334155',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** `yyyy-MM-dd` → a LOCAL `Date`. `parse` reads the parts; `new Date(iso)` would
 * read UTC midnight and land on the previous day behind UTC. */
function fromIso(iso: string | undefined): Date | null {
  if (!iso) return null;
  const parsed = parse(iso.slice(0, 10), ISO, new Date());
  return isValid(parsed) ? parsed : null;
}

function displayFrom(iso: string): string {
  const date = fromIso(iso);
  return date ? format(date, DISPLAY) : '';
}

function isoFrom(display: string): string {
  if (display === '') return '';
  const parsed = parse(display, DISPLAY, new Date());
  return isValid(parsed) && format(parsed, DISPLAY) === display ? format(parsed, ISO) : display;
}

function isBlocked(day: Date, min: Date | null, max: Date | null): boolean {
  const iso = format(day, ISO);
  if (min && iso < format(min, ISO)) return true;
  if (max && iso > format(max, ISO)) return true;
  return false;
}

function clamp(day: Date, min: Date | null, max: Date | null): Date {
  if (min && format(day, ISO) < format(min, ISO)) return min;
  if (max && format(day, ISO) > format(max, ISO)) return max;
  return day;
}
