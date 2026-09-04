// Generators, and the three things a `function*` is refused for.
//
// Its own fixture rather than a corner of `examples/unsupported`, because that
// one asserts every export in it is refused *by the lowering*. These are
// refused one step later: the generator is refused, and the function walking it
// then calls something that is not there -- which `drop_callers_of_refused`
// turns into NTS1003. Both are honest refusals and they are not the same shape,
// and a fixture that conflates them is one that stops meaning what it says.
//
// `examples/async-unsupported` is the same split for the same reason.

// `yield*`, which delegates to another iterable.
//
// One `next` on the outer generator is an unbounded number of steps on the
// inner one, so the state machine would need a nested cursor in the frame
// rather than a state number -- and the inner iterable may be anything with an
// iterator, including another generator, so the nesting has no fixed depth.
function* delegating(n: number): Generator<number, void, unknown> {
  yield* [n, n + 1];
}

export function yieldStar(n: number): number {
  let total = 0;
  for (const value of delegating(n)) {
    total = total + value;
  }
  return total;
}

// The **value** of a `yield`, which is what the caller passed to `next(v)`.
//
// A `for...of` calls `next()` with nothing, so the expression is always
// `undefined` there. Using it means the program expects a two-way
// conversation, and answering `undefined` to that is a wrong answer rather
// than a missing feature -- it runs, and produces numbers.
function* conversing(n: number): Generator<number, void, unknown> {
  const reply = yield n;
  yield reply === undefined ? n + 1 : n + 2;
}

export function yieldValue(n: number): number {
  let total = 0;
  for (const value of conversing(n)) {
    total = total + value;
  }
  return total;
}

// A generator walked somewhere other than where it was made.
//
// The resumption does not exist when the `for...of` is lowered -- `hir::suspend`
// splits the generator long afterwards -- so the loop names it from the call
// that produced the frame. A parameter has no call behind it, and the frame's
// *type* says which generator it is but not which function to call, because two
// generators may share a frame shape.
function* plainCount(n: number): Generator<number, void, unknown> {
  let i = 0;
  while (i < n) {
    yield i;
    i = i + 1;
  }
}

function sumOf(walk: Generator<number, void, unknown>): number {
  let total = 0;
  for (const value of walk) {
    total = total + value;
  }
  return total;
}

export function generatorAsAnArgument(n: number): number {
  return sumOf(plainCount(n));
}

// A `finally` that spans a `yield`, which is **iterator closing**.
//
// A `for...of` left by `break` or `return` calls `gen.return()` on the way out,
// which resumes the generator inside its `try` so the `finally` runs. Nothing
// here does that: an abandoned walk stops calling the resumption and the frame
// sits at whatever state it stopped in.
//
// This was a wrong answer that ran, and the fixture is the shape that found it.
let closedTimes = 0;

function* guarded(n: number): Generator<number, void, unknown> {
  try {
    yield n;
    yield n + 1;
  } finally {
    closedTimes = closedTimes + 1;
  }
}

export function abandonedWalk(n: number): number {
  closedTimes = 0;
  let total = 0;
  for (const value of guarded(n)) {
    total = total + value;
    break;
  }
  return total * 1000 + closedTimes;
}
