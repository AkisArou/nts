// `yield*`, which delegates to another iterable.
//
// This refused until 2026-09-12, and the reason it gave was true:
//
//   > one `next` on the outer generator is an unbounded number of steps on the
//   > inner one, so the state machine would need a nested cursor in the frame
//   > rather than a state number, and the nesting has no fixed depth.
//
// # The frame already grows one
//
// `yield* e` *is* a walk with a `yield` where the body would be — which is what
// the language says it is, for the yielding half — and built that way the hard
// part disappears. The inner walk's cursor is a value live across the `yield`
// in the body, so `hir::suspend`'s spilling puts it in the frame along with
// everything else that survives a suspension. The nested cursor is not arranged
// here; it is what the machinery that exists for ordinary locals already does.
//
// The depth follows. Each `yield*` is its own loop with its own spilled cursor,
// so three levels of delegation are three cursors in three frames — exactly as
// two nested `for...of` loops in one generator already were. There is no depth
// to fix because nothing counts.
//
// `Array.from` is the same shape one step away: "the walk with an append where
// the body would be". This is the walk with a `yield` there instead.
//
// # Why it had to come second
//
// `yield* source` where `source` is a parameter is the commonest spelling of
// this in `runtime/node`, and it delegates to a generator the callee did not
// make. That could not work until `Generator<T, …>` had a representation — see
// `a-generator-walked-elsewhere`. Building `yield*` first would have covered
// arrays and locally-made generators and refused the case the corpus actually
// writes.
//
// # What is still refused
//
// The **value** of a `yield*`, which is the inner iterator's `TReturn` rather
// than any of its elements. A second feature wearing the same syntax, and it
// says so separately.

/** The innermost generator, and the control: no delegation at all. */
function* leaf(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

export function noDelegation(n: number): number {
  let total = 0;
  for (const v of leaf(n & 3)) total += v;
  return total;
}

/** Under test: delegating to another generator, with `yield`s on both sides. */
function* around(limit: number): Generator<number> {
  yield 100;
  yield* leaf(limit);
  yield 200;
}

export function delegated(n: number): number {
  let total = 0;
  for (const v of around(n & 3)) total += v;
  return total;
}

/** Under test: delegating to an array, which is a counted walk and not a frame. */
function* overAnArray(n: number): Generator<number> {
  yield* [n, n + 1, n + 2];
}

export function toAnArray(n: number): number {
  let total = 0;
  for (const v of overAnArray(n & 7)) total += v;
  return total;
}

/** Under test: delegating to a string, walked by code point. */
function* overText(): Generator<string> {
  yield* "ab";
}

export function toAString(n: number): number {
  let total = n;
  for (const v of overText()) total += v.length;
  return total;
}

/**
 * Under test, and the shape the corpus writes: delegating to a generator that
 * **arrived as a parameter**, so nothing static says which body to resume.
 */
function* viaParameter(g: Generator<number>): Generator<number> {
  yield* g;
}

export function delegatedToAParameter(n: number): number {
  let total = 0;
  for (const v of viaParameter(leaf(n & 3))) total += v;
  return total;
}

/**
 * Under test: three levels, so the nesting is not one deep.
 *
 * `middle` delegates twice, which also proves the cursor is per-`yield*` and
 * not per-frame: two walks of the same inner generator in one body.
 */
function* middle(limit: number): Generator<number> {
  yield* leaf(limit);
  yield* leaf(limit);
}

function* top(limit: number): Generator<number> {
  yield* middle(limit);
  yield 99;
}

export function threeDeep(n: number): number {
  let total = 0;
  for (const v of top(n & 3)) total += v;
  return total;
}

/**
 * Under test: a `yield*` inside a loop, so one cursor slot is entered and left
 * many times with a different inner generator each pass.
 */
function* repeated(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield* leaf(i);
}

export function inALoop(n: number): number {
  let total = 0;
  for (const v of repeated(n & 3)) total += v;
  return total;
}

/**
 * Under test: two `yield*` over **different shapes** in one generator, so the
 * two cursors are not the same kind of thing — one is a position into an array,
 * the other a frame being resumed.
 */
function* mixed(n: number): Generator<number> {
  yield* [n, n + 1];
  yield* leaf(n & 3);
}

export function twoShapes(n: number): number {
  let total = 0;
  for (const v of mixed(n & 7)) total += v;
  return total;
}
