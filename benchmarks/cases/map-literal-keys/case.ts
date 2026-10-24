// Repeated literal-string Map queries, with hits and misses. Unlike
// str-map-keys, no string is constructed in the hot loop. An emitted literal
// can carry its settled hash in read-only storage, just as a host String does.
// Includes both native storage widths and an astral UTF-16 pair.
const keys: string[] = [
  "event:connection:opened:success",
  "event:connection:closed:normal",
  "世界:event:message:received",
  "😀:event:message:delivered",
];
const absent = "event:connection:never:registered";

export function work(seed: number): number {
  const events = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) events.set(keys[i], i + 1);
  const step = seed | 0;
  let total = 0;
  for (let i = 0; i < 8192; i++) {
    total = (total + (events.get(keys[(i ^ step) & 3]) ?? 0)) | 0;
    total = (total + (events.get(absent) ?? 0)) | 0;
  }
  return total;
}

export const seed = 5;
