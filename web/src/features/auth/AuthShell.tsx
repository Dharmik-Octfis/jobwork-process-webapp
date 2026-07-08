import type { ReactNode } from 'react';
import { Logo } from '../../components/ui/Logo';
import styles from './Auth.module.css';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

/** Split-screen shell shared by the login and signup screens. */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className={styles.page}>
      <aside className={styles.brand}>
        <div className={styles.brandDecor} />
        <div className={styles.brandTop}>
          <Logo tone="dark" size={30} />
        </div>

        <div className={styles.brandBody}>
          <h2>Production &amp; inventory, under control.</h2>
          <p>Track jobs, machines, and stock across your shop floor — in real time.</p>

          <ul className={styles.brandList}>
            <li>
              <CheckIcon /> Live production monitoring
            </li>
            <li>
              <CheckIcon /> Accurate inventory &amp; invoicing
            </li>
            <li>
              <CheckIcon /> Built for multi-tenant teams
            </li>
          </ul>
        </div>

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
      </aside>

      <main className={styles.formSide}>
        <div className={styles.card}>
          <div className={styles.mobileBrand}>
            <Logo tone="light" size={28} />
          </div>

          <header className={styles.header}>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </header>

          {children}
        </div>
      </main>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.18)" />
      <path
        d="M8 12.5l2.5 2.5 5.5-6"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
