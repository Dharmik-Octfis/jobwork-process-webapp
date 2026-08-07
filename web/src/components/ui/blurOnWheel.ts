/**
 * Stop the mouse wheel from silently editing a number field.
 *
 * A focused `<input type="number">` treats a scroll as a step: with
 * `step="0.0001"` — which every quantity here needs, because metres and
 * kilograms carry decimals — one notch of the wheel turns 100 into 99.9999.
 * Nothing highlights, nothing warns, and the wrong figure is what gets saved and
 * printed on a challan.
 *
 * Blurring is the fix rather than `preventDefault`: React attaches wheel
 * listeners passively, so preventing the default does not reliably stop the
 * browser's stepping. Losing focus does, and the page still scrolls.
 *
 * Arrow keys are deliberately left alone — Up/Down on a focused field is a
 * deliberate keystroke, not an accident of scrolling past.
 */
export function blurOnWheel(event: React.WheelEvent<HTMLInputElement>) {
  event.currentTarget.blur();
}
