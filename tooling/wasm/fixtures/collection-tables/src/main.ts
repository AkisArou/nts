// The table under a Map, a Set and a record, past what the examples reach:
// growth across several rehashes, deleted slots reused by later keys, a clear
// during a walk, erased keys of every kind, and copies.

export function growsPastSeveralRehashes(n: number): number {
  const m = new Map<string, number>();
  const count = 40 + (n & 7) * 50;
  for (let i = 0; i < count; i++) m.set("k" + i, i);
  let sum = 0;
  for (let i = 0; i < count; i += 3) sum += m.get("k" + i) ?? -1000;
  return sum * 1000 + m.size;
}

export function numberKeysGrow(n: number): number {
  const s = new Set<number>();
  for (let i = 0; i < 300; i++) s.add((i * 7919 + n) % 1000);
  let first = -1;
  for (const v of s) {
    first = v;
    break;
  }
  return s.size * 10000 + first;
}

export function deletedSlotsAreReused(n: number): number {
  const m = new Map<string, number>();
  for (let round = 0; round < 50; round++) {
    m.set("a" + (round % 5), round);
    m.delete("a" + ((round + 2) % 5));
  }
  let order = 0;
  for (const [key, value] of m) order = order * 100 + value + key.length;
  return order + n;
}

export function aClearDuringAWalkEndsIt(n: number): number {
  const s = new Set<number>([1, 2, 3]);
  let seen = 0;
  for (const v of s) {
    seen = seen * 10 + v;
    if (v === 1) {
      s.clear();
      s.add(7 + (n & 1));
    }
  }
  return seen * 10 + s.size;
}

export function erasedKeysOfEveryKind(n: number): number {
  const m = new Map<unknown, number>();
  const keys: unknown[] = ["1", 1, true, false, null, undefined, NaN, 0, -0, "", n];
  let i = 0;
  for (const key of keys) m.set(key, i++);
  let total = m.size * 1000;
  for (const key of keys) total += (m.get(key) ?? -50) * 3;
  let zero = 0;
  for (const key of m.keys()) if (key === 0) zero = 1 / (key as number);
  return total + (m.has(0 / 0) ? 1 : 0) + (zero === Infinity ? 2 : 0);
}

export function aRecordCopiedAndExtended(n: number): number {
  const base: Record<string, number> = { b: 2, a: 1, "10": 10, "2": 20 };
  const copy: Record<string, number> = { ...base };
  copy["c"] = 3 + n;
  const target: Record<string, number> = { z: 26 };
  Object.assign(target, copy);
  let order = 0;
  for (const key of Object.keys(target)) order = order * 7 + key.length + (target[key] ?? 0);
  return order;
}
