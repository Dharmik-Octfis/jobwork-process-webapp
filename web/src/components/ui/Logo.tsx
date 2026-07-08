import { cn } from '../../lib/cn';
import markSrc from '../../assets/octfis-mark.gif';
import wordmarkWhite from '../../assets/octfis-wordmark-white.png';
import wordmarkGreen from '../../assets/octfis-wordmark-green.png';
import styles from './Logo.module.css';

interface LogoProps {
  /** Surface tone: 'dark' → white wordmark + tiled mark; 'light' → green wordmark. */
  tone?: 'dark' | 'light';
  /** Mark height in px (the wordmark scales from this). */
  size?: number;
  /** Show the "OCTFIS TECHNO LLP" wordmark next to the mark. */
  showWord?: boolean;
}

/** OCTFIS brand lockup: hummingbird mark + official wordmark. */
export function Logo({ tone = 'dark', size = 30, showWord = true }: LogoProps) {
  const isDark = tone === 'dark';
  return (
    <div className={cn(styles.brand, isDark && styles.onDark)}>
      <img
        className={styles.mark}
        src={markSrc}
        width={size}
        height={size}
        alt="OCTFIS"
        draggable={false}
      />
      {showWord && (
        <img
          className={styles.word}
          src={isDark ? wordmarkWhite : wordmarkGreen}
          style={{ height: Math.round(size * 1.25) }}
          alt="OCTFIS TECHNO LLP"
          draggable={false}
        />
      )}
    </div>
  );
}
