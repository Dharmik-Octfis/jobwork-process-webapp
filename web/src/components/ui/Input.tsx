import { forwardRef, useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Inline, specific validation message (UI/UX §8). */
  error?: string;
  /** Optional helper text shown below the field when there is no error. */
  hint?: string;
}

/**
 * Design-system text input with a real (always-visible) label, inline error,
 * and — for `type="password"` — a show/hide toggle. Forwards its ref so it
 * plugs straight into react-hook-form's `register`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, type = 'text', id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedById = `${inputId}-desc`;

  const isPassword = type === 'password';
  const [revealed, setRevealed] = useState(false);
  const resolvedType = isPassword && revealed ? 'text' : type;

  const hasError = Boolean(error);

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId} style={rest.required ? { color: '#ef4444' } : undefined}>
        {label}
        {rest.required && '*'}
      </label>

      <div className={styles.inputWrap}>
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={cn(
            styles.input,
            hasError && styles.invalid,
            isPassword && styles.hasTrailing,
            className,
          )}
          aria-invalid={hasError}
          aria-describedby={error || hint ? describedById : undefined}
          {...rest}
        />

        {isPassword && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            tabIndex={-1}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {error ? (
        <p id={describedById} className={styles.error}>
          <AlertIcon />
          {error}
        </p>
      ) : hint ? (
        <p id={describedById} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 2.6-.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
    </svg>
  );
}
