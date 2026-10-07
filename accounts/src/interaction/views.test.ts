import { describe, it, expect } from 'vitest';
import { escapeHtml, loginPage } from './views.ts';

/**
 * The sign-in page is server-rendered by string concatenation, which is fine right
 * up until something interpolated is not escaped. It renders a client NAME from the
 * database and an EMAIL the visitor just typed, so both are attacker-influenced.
 *
 * 🔴 An injection here is not a defaced page — it is script running on the origin
 * that holds the SSO cookie for every app in the estate, next to a password field.
 */

describe('escapeHtml', () => {
  it('escapes every character that can break out of markup or an attribute', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand first, so escapes are not double-decoded', () => {
    // Getting this order wrong yields `&amp;lt;`, which renders as `&lt;` — the
    // classic way an escaper appears to work while emitting the wrong thing.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('loginPage', () => {
  it('escapes the client name, which comes from the database', () => {
    const html = loginPage({ uid: 'u1', clientName: '<img src=x onerror=alert(1)>' });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes the email, which the visitor just typed', () => {
    const html = loginPage({ uid: 'u1', clientName: 'App', email: '"><script>alert(1)</script>' });

    expect(html).not.toContain('<script>alert(1)</script>');
    // Specifically: the quote must not close the `value="…"` attribute.
    expect(html).toContain('&quot;&gt;');
  });

  it('escapes the error message', () => {
    const html = loginPage({ uid: 'u1', clientName: 'App', error: '<b>nope</b>' });

    expect(html).not.toContain('<b>nope</b>');
  });

  it('url-encodes the uid into the form action', () => {
    const html = loginPage({ uid: 'a/../b', clientName: 'App' });

    // The uid lands in a URL path, so it needs encoding rather than HTML escaping.
    expect(html).toContain('/interaction/a%2F..%2Fb/login');
  });
});
