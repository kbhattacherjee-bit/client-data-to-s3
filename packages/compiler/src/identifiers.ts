/** Names the app itself creates or exposes (output columns, folders). */
export const OUTPUT_NAME_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Quotes an identifier that came from the catalog. Anything that could end the quoted
 * identifier or confuse a tokenizer is rejected or escaped. User text never gets here:
 * the planner only passes names it has matched against the catalog.
 */
export function quoteIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) {
    throw new Error('Invalid identifier length');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid character in identifier');
  return '"' + name.replace(/"/g, '""') + '"';
}

export function physicalName(name: string, mode: 'upper' | 'lower' | 'preserve'): string {
  return mode === 'upper' ? name.toUpperCase() : mode === 'lower' ? name.toLowerCase() : name;
}
