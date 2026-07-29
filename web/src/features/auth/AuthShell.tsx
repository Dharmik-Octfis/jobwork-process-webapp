import type { ReactNode } from 'react';
import { LogisticsBackground } from '../../components/ui/LogisticsBackground';
import styles from './Auth.module.css';

interface AuthShellProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthShell({
  title = "Sign in",
  subtitle = "to access your account",
  children,
}: AuthShellProps) {
  return (
    <LogisticsBackground>
      {/* Top Left Logo Container (Zoho Style) */}
      <div className={styles.brandHeader}>
        <img
          src="https://cliq.zoho.com/company/664110924/v2/organisations/664110924/logo?nocache=1702121047562"
          alt="OCTFIS Logo"
          className={styles.logoGif}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>

      {/* Header aligned to left */}
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </header>

      {/* Form Content */}
      {children}

      {/* Card Footer Links */}
      <footer className={styles.cardFooter}>
        <a href="https://www.octfis.com" target="_blank" rel="noreferrer">
          <GlobeIcon />
          octfis.com
        </a>
        <span className={styles.footerDivider} />
        <a href="mailto:sales@octfis.com">
          <MailIcon />
          sales@octfis.com
        </a>
      </footer>
    </LogisticsBackground>
  );
}

function GlobeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M4 7l8 6 8-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}