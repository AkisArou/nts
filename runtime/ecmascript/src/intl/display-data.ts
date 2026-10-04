// Public ICU name data. field is -1 for identifier names, otherwise the
// shared DisplayNames date-time-field ordinal (0..11). Missing data is distinct
// from the public operation's code/none fallback, which stays in shared TS.
export interface DisplayNamesPrimitive {
  name(code: string, field: number): string | undefined;
}
