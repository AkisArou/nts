// An absence a table holds keeps its tag.
//
// A key or a value crosses into a table erased, and the erasure said a null
// pointer could not be absent: every table site answered `Impossible`. So a
// `string | undefined` key that was `undefined` crossed as a string with a
// null pointer, and hashing it faulted on C and LLVM -- here at `new Set(xs)`
// and `new Map(entries)`, and at `get` and `set` in
// tests/outcomes/a-map-key-that-may-be-absent-erased-as-a-string. And a
// `Box | null` value that was `null` crossed as an object: it read back right
// at its own type, because the unerase restored the pointer, and as "object"
// through `unknown`, which reads the tag. Each now erases with the absence the
// type it is written at allows.
//
// The control, a-presence-a-table-holds-keeps-its-tag, stores present values
// in the same tables.
class Box {
  constructor(public n: number) {}
}
const maybe = (seed: number): Box | null => ((seed & 1) === 0 ? null : new Box(seed));
const maybeU = (seed: number): Box | undefined => ((seed & 1) === 0 ? undefined : new Box(seed));

/** A record's stored `null`, read through `unknown`. */
export function recordValueTag(seed: number): string {
  const r: Record<string, Box | null> = {};
  r.held = maybe(seed);
  const u: unknown = (r as Record<string, unknown>).held;
  return u === null ? "null" : typeof u;
}

/** A record literal's `null` for an object value, read through `unknown`. */
export function recordLiteralTag(seed: number): string {
  const r: Record<string, Box | null> = { held: null, other: new Box(seed) };
  const u: unknown = (r as Record<string, unknown>)[(seed & 1) === 0 ? "held" : "other"];
  return u === null ? "null" : typeof u;
}

/** A map's stored `undefined`, read through `unknown`. */
export function mapValueTag(seed: number): string {
  const m = new Map<string, Box | undefined>();
  m.set("a", maybeU(seed));
  const u: unknown = (m as Map<string, unknown>).get("a");
  return u === undefined ? "undefined" : typeof u;
}

/** `new Set(xs)` over elements that may be absent. */
export function setOfMaybeStrings(seed: number): number {
  const xs: (string | undefined)[] = ["a", (seed & 1) === 0 ? undefined : "b", "undefined"];
  const s = new Set(xs);
  return s.size * 10 + (s.has(undefined) ? 1 : 0);
}

/** `new Map(entries)` whose keys may be absent. */
export function mapOfMaybeKeys(seed: number): number {
  const entries: [string | null, number][] = [["null", 1], [(seed & 1) === 0 ? null : "x", 2]];
  const m = new Map(entries);
  return m.size * 100 + (m.get(null) ?? 0) * 10 + (m.get("null") ?? 0);
}

/** A map's absent key, read back out of the table by `forEach`. */
export function keysReadBack(seed: number): number {
  const m = new Map<string | undefined, number>();
  m.set(undefined, 1);
  m.set((seed & 1) === 0 ? "u" : undefined, 2);
  let absent = 0;
  m.forEach((_value, key) => {
    if (key === undefined) absent += 1;
  });
  return m.size * 10 + absent;
}
