/**
 * 🔴 KEPT NATIVE ON PURPOSE. `<input type="radio">` already gives focus, arrow-key
 * movement inside the group, Space to pick, `disabled` semantics and a focus ring
 * — all of which a `<div onClick>` version has to re-implement and half of which
 * it always forgets. Nothing here needs `downshift`; there is no listbox, no
 * typeahead and no open/close state.
 *
 * The one thing this adds over a bare pair of inputs is a disabled option that
 * says WHY it is disabled. An alternative that is real but not available yet
 * reads as a broken screen unless the reason sits beside it — which is exactly
 * the jobwork case: "receive at the processor" only exists once a challan is
 * ticked.
 */
export interface RadioGroupOption<T extends string> {
  value: T;
  label: string;
  /** Present = this option cannot be picked, and this says why. Shown beside it. */
  disabledReason?: string;
}

interface Props<T extends string> {
  /**
   * ⚠️ Must be unique on the page. Native radios group by `name`, so two groups
   * sharing one would fight over a single selection.
   */
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: RadioGroupOption<T>[];
  /** Names the group for a screen reader — the visible `<label>` sits outside it. */
  ariaLabel: string;
}

export function RadioGroup<T extends string>({
  name,
  value,
  onChange,
  options,
  ariaLabel,
}: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 20, rowGap: 0 }}
    >
      {options.map((option) => {
        const disabled = Boolean(option.disabledReason);
        const active = option.value === value && !disabled;
        return (
          <label
            key={option.value}
            title={option.disabledReason}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              /* ≥44px of HIT AREA without a visible box: the row reads as plain
                 radios, but a thumb on a phone still has something to hit. A
                 bordered pill would have given the target for free and looked
                 like a segmented control, which is not what this is. */
              minHeight: 44,
              fontSize: 13,
              color: disabled ? '#94a3b8' : '#334155',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              // `accentColor` tints the native control, so the dot matches the
              // app's blue without replacing the input and losing its keyboard
              // behaviour and focus ring.
              style={{
                accentColor: '#0062ff',
                width: 15,
                height: 15,
                margin: 0,
                cursor: 'inherit',
              }}
            />
            {option.label}
            {option.disabledReason && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>— {option.disabledReason}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
