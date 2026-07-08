import styles from './Auth.module.css';

/** Form-level error banner (icon + message — never color alone; UI/UX §6). */
export function FormErrorBanner({ message }: { message: string }) {
  return (
    <div className={styles.formError} role="alert">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
