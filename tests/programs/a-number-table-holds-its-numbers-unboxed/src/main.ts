// A `Map<number, number>` and a `Set<number>` hold their keys and values as
// bare doubles on the JVM (`NtsTable`'s number columns), read and written
// through entry points that take them unboxed. Each export is one rule a box
// kept for free and a column has to keep on purpose: NaN is one key however it
// was made, -0 is the key +0 and iterates as +0, a value of -0 keeps its sign,
// a deleted entry leaves a hole the walk skips, a key deleted and set again
// moves to the end, and a cleared table is refilled from the start.
//
// The column's one-way turn -- a typed table handed a string through a
// `Map<unknown, unknown>` view -- is the JVM crate's own test
// (`whole_program.rs`, `a_number_table_handed_a_string_turns_its_columns`):
// Wasm declines that upcast, and this corpus holds what every backend
// compiles.

export function nanAndZeroAreOneKeyEach(seed: number): string {
  const m = new Map<number, number>();
  m.set(NaN, seed);
  m.set(Math.sqrt(-1 - seed), seed + 1);
  m.set(-0, seed + 2);
  m.set(0, seed + 3);
  const keys: string[] = [];
  for (const k of m.keys()) keys.push(Object.is(k, -0) ? "-0" : String(k));
  return m.size + " " + m.get(0 / 0) + " " + m.get(-0) + " " + keys.join(",");
}

export function aNegativeZeroValueKeepsItsSign(seed: number): number {
  const m = new Map<number, number>();
  m.set(seed, -0);
  return 1 / (m.get(seed) ?? 1);
}

export function holesAreSkippedInOrder(seed: number): string {
  const m = new Map<number, number>();
  for (let i = 0; i < 20; i++) m.set(i * 1.5 + seed, i);
  for (let i = 0; i < 20; i += 3) m.delete(i * 1.5 + seed);
  m.set(seed, 100);
  m.set(1.5 + seed, 200);
  const out: string[] = [];
  for (const [k, v] of m) out.push(k + ":" + v);
  return out.join(" ");
}

export function aSetOfNumbersCopiedOut(seed: number): string {
  const s = new Set<number>();
  for (let i = 0; i < 12; i++) s.add(((i * 7) % 5) + seed);
  s.delete(seed + 1);
  return Array.from(s).join(",") + " " + s.has(seed + 2) + " " + s.has(seed + 1);
}

export function clearedAndRefilled(seed: number): string {
  const m = new Map<number, number>();
  for (let i = 0; i < 10; i++) m.set(i, i + seed);
  m.clear();
  m.set(seed, 7);
  let total = 0;
  for (const v of m.values()) total += v;
  return m.size + " " + total + " " + m.has(0);
}
