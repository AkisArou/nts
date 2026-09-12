// expect: a `for...in` over something without named fields
//
// `for (const k in xs)` where `xs` is an **array**.
//
// `for...in` over an object landed on 2026-09-12 as the same walk `for...of`
// uses over a different sequence — the layout's field names instead of the
// elements. An array has no field names, and what node answers for one is its
// **indices as strings**:
//
//     for (const k in [10, 20]) ...   ->   "0", "1"
//
// which is a third list: not the elements, and not any layout's fields. Building
// it means materialising a string per index, which nothing in the profile asks
// for — `for...in` has **zero uses in `runtime/node`** — so it is refused rather
// than answered with the field-name list, which would be silently empty.
//
// # The refusal says `for...in` rather than `Object`
//
// This shares `decide_object_keys` with the `Object.keys` lowering, and that
// helper refuses an array as "an `Object` static over something that is not an
// object here". True of the helper and false of the source, which wrote no
// `Object` at all — the same shape as `a method `next` with no declaration in
// the hierarchy` said of a generator. The loop names its own refusal.
//
// # The controls
//
// `overAnObject` is the case that works and must keep working; if it ever
// refuses, this fixture is about something else. `viaObjectKeys` is the same
// keys through the call that was always supported, which separates "the walk is
// broken" from "the key list is".

class Point {
  x: number;
  y: number;
  constructor(n: number) {
    this.x = n;
    this.y = n + 1;
  }
}

/** Control: over an object, which lowers. */
export function overAnObject(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k in p) total += k.length;
  return total;
}

/** Control: the same keys through `Object.keys`. */
export function viaObjectKeys(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k of Object.keys(p)) total += k.length;
  return total;
}

/** Under test: over an array, whose keys are its indices as strings. */
export function overAnArray(n: number): number {
  const xs = [10, 20, 30];
  let total = 0;
  for (const k in xs) total += k.length;
  return total + (n & 1);
}
