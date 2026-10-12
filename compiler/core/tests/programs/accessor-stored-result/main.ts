interface RecordValue { readonly amount: number; readonly valid: boolean; }
interface Entry { readonly record: RecordValue; }
function amount(value: RecordValue): number { return value.amount; }
function entries(n: number): Entry[] {
  const record = {amount: n, valid: false};
  const entry = {record};
  return [entry];
}
export function read(entries: readonly Entry[]): number {
  const entry = entries[0];
  if (entry === undefined) return 0;
  return amount(entry.record);
}
export function observe(n: number): number { return read(entries(n)); }
export function observeDirect(n: number): number {
  return read([{record: {amount: n, valid: false}}]);
}
