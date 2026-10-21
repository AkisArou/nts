// A map miss read through `!`, and a record's missing key, at a number.
//
// `!` only asserts a type, so `m.get(k)!` is `undefined` where `k` is
// missing, and a record's missing key is `undefined` though the checker types
// it `number`. JavaScript then does what each consumer does with `undefined`:
// arithmetic and a relational comparison apply ToNumber (NaN; `null` is 0),
// an equality with a number is false for both absences, a condition is
// `false`, `typeof` says "undefined". The read was unerased to the number the
// type claimed, so it answered the payload the runtime put beside `undefined`:
// 0 for a map miss on C, LLVM and the JVM (`m.get(k)! + 1` was 1), while Wasm
// declined it.
//
// What a consumer that sees `undefined` as it is does -- `String(v)`, a store
// -- declines by name instead:
// tests/outcomes/a-map-miss-read-through-a-non-null-assertion-as-text.
//
// The control, a-map-hit-read-through-a-non-null-assertion-as-a-number, reads
// keys that are there.
const counts = new Map<string, number>([["a", 1], ["b", 2]]);
const maybe = new Map<string, number | null>();
maybe.set("a", 1);
maybe.set("held", null);
const flags = new Map<string, boolean>([["on", true]]);
const record: Record<string, number> = { a: 1 };
const nullable: Record<string, number | null> = { a: 1 };
nullable.held = null;

function key(seed: number): string {
  return (seed & 1) === 0 ? "a" : "missing";
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
  return maybe.get((seed & 1) === 0 ? "a" : "held")! === 0 ? 1 : 0;
}

/** A record's missing key compared: `undefined < 1` is false. */
export function below(seed: number): number {
  return record[(seed & 1) === 0 ? "a" : "missing"] < 1 ? 1 : 0;
}

/** A record's stored `null` through `!`, compared: `null < 1` is true. */
export function belowNull(seed: number): number {
  return nullable[(seed & 1) === 0 ? "a" : "held"]! < 1 ? 1 : 0;
}

/** A boolean map miss as a condition. */
export function lit(seed: number): number {
  return flags.get((seed & 1) === 0 ? "on" : "off")! ? 1 : 0;
}
