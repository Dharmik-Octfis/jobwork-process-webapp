// react-hook-form nests errors by field path (lineItems → [i] → discountValue)
export function firstErrorMessage(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const { message } = node as { message?: unknown };
  if (typeof message === 'string' && message) return message;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'ref') continue; // a DOM node — walking it walks React's fiber tree
    const found = firstErrorMessage(child);
    if (found) return found;
  }
  return undefined;
}
