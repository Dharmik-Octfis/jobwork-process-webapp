import styles from './Spinner.module.css';

interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Stroke thickness in px. */
  thickness?: number;
  /** Accessible label for screen readers. */
  label?: string;
}

/** Indeterminate loading indicator. */
export function Spinner({ size = 18, thickness = 2, label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={styles.spinner}
      style={{ width: size, height: size, borderWidth: thickness }}
      role="status"
      aria-label={label}
    />
  );
}
