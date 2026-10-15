// A `(T | null)[]` read where its type is gone: its null slot is node's
// `null`, because the erasure marked the array (`arrays::mark_null_slots`),
// where a `(T | undefined)[]`, the control, reads `undefined` from the same
// null pointer. Past either end, or at a fraction, both read `undefined`.
//
// Read in another function (`second`, the open-element helper) and in the
// function that erased it (the shape known, read in line).

class Point {
  constructor(public x: number) {}
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${value}`;
  return value instanceof Point ? `point:${value.x}` : "other";
}

function element(a: unknown, at: number): unknown {
  return Array.isArray(a) ? a[at] : "not an array";
}

export function nullsThroughACall(at: number): string {
  const xs: (string | null)[] = ["a", null, "c"];
  return describe(element(xs, at));
}

export function undefinedsThroughACall(at: number): string {
  const xs: (string | undefined)[] = ["a", undefined, "c"];
  return describe(element(xs, at));
}

export function pointsThroughACall(at: number): string {
  const xs: (Point | null)[] = [new Point(1), null, new Point(3)];
  return describe(element(xs, at));
}

export function nullsInLine(at: number): string {
  const xs: (string | null)[] = ["a", null, "c"];
  const a: unknown = xs;
  return Array.isArray(a) ? describe(a[at]) : "not an array";
}

export function undefinedsInLine(at: number): string {
  const xs: (string | undefined)[] = ["a", undefined, "c"];
  const a: unknown = xs;
  return Array.isArray(a) ? describe(a[at]) : "not an array";
}

// Grown after it was erased: the mark is the array's, not the backing's.
export function grownAfterTheErase(at: number): string {
  const xs: (string | null)[] = [];
  const a: unknown = xs;
  for (let i = 0; i < 4; i++) xs.push(i % 2 === 0 ? `s${i}` : null);
  return describe(element(a, at));
}
