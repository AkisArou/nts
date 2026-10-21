// The control for an-absence-a-table-holds-keeps-its-tag: the same tables
// holding present values, which every backend erased and read back right
// before that one was fixed.
class Box {
  constructor(public n: number) {}
}
const present = (seed: number): Box => new Box(seed);

/** A record's stored object, read through `unknown`. */
export function recordValueTag(seed: number): string {
  const r: Record<string, Box> = {};
  r.held = present(seed);
  const u: unknown = (r as Record<string, unknown>).held;
  return u === null ? "null" : typeof u;
}

/** A record literal's object value, read through `unknown`. */
export function recordLiteralTag(seed: number): string {
  const r: Record<string, Box> = { held: new Box(seed + 1), other: new Box(seed) };
  const u: unknown = (r as Record<string, unknown>)[(seed & 1) === 0 ? "held" : "other"];
  return u === null ? "null" : typeof u;
}

/** A map's stored object, read through `unknown`. */
export function mapValueTag(seed: number): string {
  const m = new Map<string, Box>();
  m.set("a", present(seed));
  const u: unknown = (m as Map<string, unknown>).get("a");
  return u === undefined ? "undefined" : typeof u;
}

/** `new Set(xs)` over present strings. */
export function setOfMaybeStrings(seed: number): number {
  const xs: string[] = ["a", (seed & 1) === 0 ? "c" : "b", "undefined"];
  const s = new Set(xs);
  return s.size * 10 + (s.has("c") ? 1 : 0);
}

/** `new Map(entries)` whose keys are present strings. */
export function mapOfMaybeKeys(seed: number): number {
  const entries: [string, number][] = [["null", 1], [(seed & 1) === 0 ? "n" : "x", 2]];
  const m = new Map(entries);
  return m.size * 100 + (m.get("n") ?? 0) * 10 + (m.get("null") ?? 0);
}

/** A map's present keys, read back out of the table by `forEach`. */
export function keysReadBack(seed: number): number {
  const m = new Map<string, number>();
  m.set("v", 1);
  m.set((seed & 1) === 0 ? "u" : "v", 2);
  let named = 0;
  m.forEach((_value, key) => {
    if (key === "v") named += 1;
  });
  return m.size * 10 + named;
}
