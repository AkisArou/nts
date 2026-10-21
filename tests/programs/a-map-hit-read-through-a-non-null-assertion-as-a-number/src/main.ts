// The control for a-map-miss-read-through-a-non-null-assertion-as-a-number:
// the same reads of keys that are there, which every backend
// answered right before that one was fixed.
const counts = new Map<string, number>([["a", 1], ["b", 2]]);
const maybe = new Map<string, number | null>();
maybe.set("a", 1);
maybe.set("held", null);
const flags = new Map<string, boolean>([["on", true]]);
const record: Record<string, number> = { a: 1, b: 0 };
const nullable: Record<string, number | null> = { a: 1 };
nullable.b = 0;

function key(seed: number): string {
  return (seed & 1) === 0 ? "a" : "b";
}

/** Arithmetic on a map miss: NaN, as `undefined + 1` is. */
export function next(seed: number): number {
  return counts.get(key(seed))! + 1;
}

/** Scaled, and compared: NaN, and `undefined < 2` is false. */
export function scaled(seed: number): number {
  const v = counts.get(key(seed))! * 2;
  return counts.get(key(seed))! < 2 ? v : -v;
}

/** `typeof`, and `=== undefined`, ask the tag. */
export function asked(seed: number): string {
  const missing = counts.get(key(seed))! === undefined ? "missing" : "there";
  return typeof counts.get(key(seed))! + " " + missing;
}

/** A stored `null` equals no number: `null === 0` is false. */
export function nullIsNotZero(seed: number): number {
  return maybe.get("a")! === 0 ? 1 : 0;
}

/** A record's missing key compared: `undefined < 1` is false. */
export function below(seed: number): number {
  return record[(seed & 1) === 0 ? "a" : "b"] < 1 ? 1 : 0;
}

/** A record's stored `null` through `!`, compared: `null < 1` is true. */
export function belowNull(seed: number): number {
  return nullable[(seed & 1) === 0 ? "a" : "b"]! < 1 ? 1 : 0;
}

/** A boolean map miss as a condition. */
export function lit(seed: number): number {
  return flags.get("on")! ? 1 : 0;
}
