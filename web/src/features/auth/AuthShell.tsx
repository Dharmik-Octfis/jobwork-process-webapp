import type { ReactNode } from 'react';
import { Logo } from '../../components/ui/Logo';
import { LogisticsBackground } from '../../components/ui/LogisticsBackground';
import styles from './Auth.module.css';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

/** Centered auth shell shared by the login and signup screens. */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className={styles.page}>
      <LogisticsBackground />

      {/* Centered Logo at the top */}
      <div className={styles.brandTop}>
        <Logo tone="dark" size={32} />
      </div>

      <main className={styles.formSide}>
        <div className={styles.card}>
          <header className={styles.header}>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>

          {children}
        </div>
      </main>

      <footer className={styles.heroContact}>
        <a href="https://www.octfis.com" target="_blank" rel="noreferrer">
          <GlobeIcon />
          www.octfis.com
        </a>
        <a href="mailto:sales@octfis.com">
          <MailIcon />
          sales@octfis.com
        </a>
        <a href="tel:+919737042720" className={styles.phoneLink}>
          <PhoneIcon />
          9737042720/21
        </a>
      </footer>

    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M4 7l8 6 8-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
