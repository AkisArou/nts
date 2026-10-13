// Map and Set keys compare by SameValueZero: NaN is one key however it was
// made, and -0 and +0 are one key, stored as +0.
export function nanFindsNaN(n: number): number {
  const m = new Map<number, number>();
  m.set(NaN, 1 + n);
  return m.get(0 / 0) ?? -1;
}

export function nanIsOneSetEntry(n: number): number {
  const s = new Set<number>();
  s.add(NaN);
  s.add(Math.sqrt(-1));
  s.add(n);
  return s.size;
}

export function negativeZeroFindsZero(n: number): number {
  const m = new Map<number, number>();
  m.set(0, 5 + n);
  return m.get(-0) ?? -1;
}

export function negativeZeroIsStoredAsZero(n: number): number {
  const m = new Map<number, number>();
  m.set(-0, n);
  let found = 0;
  for (const key of m.keys()) found = 1 / key;
  return found;
}

export function setHasNegativeZero(n: number): number {
  const s = new Set<number>([0]);
  return (s.has(-0) ? 10 : 0) + (s.has(n) ? 1 : 0);
}
