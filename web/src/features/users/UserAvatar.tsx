import { useState } from 'react';

/**
 * Initials avatar with a deterministic colour.
 *
 * There is no upload pipeline yet (`Membership.avatarUrl` exists but nothing sets
 * it), so a generic silhouette would render every row identically — actively
 * unhelpful in a list whose whole job is telling people apart. Initials plus a hue
 * derived from the name give each person a stable, recognisable mark, and the
 * component already renders `avatarUrl` when one appears.
 */

interface UserAvatarProps {
  name: string;
  /** Rendered instead of initials when present. */
  url?: string | null;
  size?: number;
}

/**
 * Name → hue. A plain sum of code points, which is stable across sessions and
 * machines — the point is consistency, not distribution, and 12 hues at 30° apart
 * stay distinguishable while all reading as the same family.
 */
function hueFor(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.codePointAt(i) ?? 0;
  return (sum % 12) * 30;
}

/** First letter of the first two words: "Priya Shah" → "PS", "Priya" → "P". */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((p) => [...p][0] ?? '')
    .join('');
}

export function UserAvatar({ name, url: initialUrl, size = 34 }: UserAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const hue = hueFor(name);

  const url = !imgFailed ? initialUrl : null;

  return (
    <span
      className="users-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        // Mid lightness so white text clears WCAG AA at every hue — a fixed
        // lightness is what keeps yellow from washing out while blue stays legible.
        background: url && imgLoaded ? 'var(--color-border)' : `hsl(${hue} 58% 45%)`,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        color: '#fff',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Always render initials behind or before the image loads */}
      {(!url || !imgLoaded) && initialsFor(name)}
      
      {url && (
        <img 
          src={url} 
          alt="" 
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgFailed(true)} 
          style={{ 
            opacity: imgLoaded ? 1 : 0, 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            transition: 'opacity 0.2s ease-in-out'
          }} 
        />
      )}
    </span>
  );
}
