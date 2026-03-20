/**
 * CQL (Confluence Query Language) utilities.
 */

/** Escape a value for safe interpolation into CQL strings. */
export function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
