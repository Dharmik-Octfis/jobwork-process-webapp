/** `https://host[:port]` exactly as a browser sends it in `Origin` — nothing more. */
export function isExactOrigin(value: string): boolean {
  // The URL parser accepts `*` as a hostname character, so `https://*.octfis.com`
  // would otherwise pass — a pattern mistaken for an origin.
  if (value.includes('*')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  return secure && url.origin === value;
}
