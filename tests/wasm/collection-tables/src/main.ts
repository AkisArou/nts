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

function opened(n: number): unknown {
  const at = ((n % 5) + 5) % 5;
  if (at === 0) return new Map<string, number>([["k", n]]);
  if (at === 1) {
    const record: Record<string, number> = {};
    record["k"] = n;
    return record;
  }
  if (at === 2) return new Set<string>(["k"]);
  if (at === 3) return new Map<number, number>([[n, 1]]);
  return [n];
}

/** A record holds what a string-keyed Map holds, laid out alike, and is
 * neither a Map nor a Set; a Set is not a Map. */
export function whichCollection(n: number): string {
  const value = opened(n);
  return `${value instanceof Map}|${value instanceof Set}`;
}

/** A get whose users only test its tag and read it as the stored type is
 * read as its entry, never boxed: booleans and numbers, hits and misses, a
 * record's reads, and beside them a get that is also printed, which stays
 * boxed. */
export function typedReads(n: number): number {
  const flags = new Map<string, boolean>();
  const nums = new Map<number, number>();
  const record: Record<string, number> = {};
  for (let i = 0; i < 8; i++) {
    flags.set("f" + i, i % 3 === 0);
    nums.set(i * 1.5, i - 4);
    record["r" + i] = i * i;
  }
  let total = 0;
  for (let i = 0; i < 12; i++) {
    const k = (i + n + 12) % 12;
    total += (flags.get("f" + k) ?? false) ? 100 : 1;
    total += nums.get(k * 1.5) ?? -1000;
    total += record["r" + (k % 8)];
  }
  return total + String(nums.get(n * 1.5)).length;
}

/** A live cursor skips a deleted entry, visits an append and stops after
 * the last entry. The deleted slot must not become a reused cursor. */
export function deletingAndAppendingDuringAWalk(n: number): number {
  const m = new Map<number, number>([[1, 10], [2, 20], [3, 30]]);
  let seen = 0;
  for (const [key, value] of m) {
    seen = seen * 100 + key + value;
    if (key === 1) {
      m.delete(2);
      m.set(4, 40 + (n & 1));
    }
  }
  return seen;
}

/** Typed key/value cursor reads keep fractions, NaN and signed zero values;
 * only the cursor changes representation. Empty walks read no entry. */
export function cursorReadsKeepTheirNumericValues(n: number): number {
  const m = new Map<number, number>();
  if (n & 1) {
    m.set(1.5, -0);
    m.set(NaN, 2.75);
    m.set(-0, Infinity);
  }
  let flags = 0;
  for (const [key, value] of m) {
    if (key === 1.5 && Object.is(value, -0)) flags += 1;
    if (Number.isNaN(key) && value === 2.75) flags += 2;
    if (Object.is(key, 0) && value === Infinity) flags += 4;
  }
  return flags;
}

/** Erased cursor reads retain the tag, including null and undefined. */
export function cursorReadsKeepTheirErasedTags(n: number): string {
  const m = new Map<unknown, unknown>();
  m.set("key", n);
  m.set(null, undefined);
  m.set(false, "tail");
  let text = "";
  for (const [key, value] of m) text += `${typeof key}:${String(key)}=${String(value)};`;
  return text;
}
