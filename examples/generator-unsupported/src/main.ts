// Generators, and the three things a `function*` is still refused for.
//
// Its own fixture rather than a corner of `examples/unsupported`, because that
// one asserts every export in it is refused *by the lowering*. These are
// refused one step later: the generator is refused, and the function walking it
// then calls something that is not there -- which `drop_callers_of_refused`
// turns into NTS1003. Both are honest refusals and they are not the same shape,
// and a fixture that conflates them is one that stops meaning what it says.
//
// `examples/async-unsupported` is the same split for the same reason.

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

// A generator that yields **nothing**.
//
// `Generator<void, void, string>` is driven entirely by what the caller passes
// to `next(v)`: the elements go *in*, not out. So there is no element, the
// frame's `yielded` slot has no type, and the abstract generator every frame
// extends cannot be laid out -- C says it exactly, `field has incomplete type
// 'void'`.
//
// This is the shape `runtime/node/readline`'s `emitKeys` has, and it is why it
// is refused by name here rather than left to fail at the layout: the honest
// sentence is about the generator, and the layout's would be about a struct the
// source never wrote. It cost the `fs` and `readline` addons their build for an
// hour, with the refusal counts saying nothing -- the cascade was identical to
// the byte and only the emitted C differed.
function* driven(): Generator<void, void, string> {
  yield;
  yield;
}

// Not walked with `for...of`: the checker rejects that outright, because
// `next` expects a `string` and a `for...of` always sends `undefined`. Which is
// the language agreeing that the elements of this generator go in rather than
// out.
export function yieldsNothing(n: number): number {
  driven();
  return n;
}

// A `function*` with **no `yield` in it**, walked.
//
// Its element type is `never`, and the walk reads the frame's `yielded` slot
// inside the loop body — a body the resumption can never enter, since it
// answers `done` at once. The read is still emitted, and a value of type
// `never` reaching code generation is **invalid HIR**: `emit-c` prints
// `refusing to emit code from invalid HIR`, writes nothing and exits 0, so the
// program failed with no diagnostic naming anything.
//
// Refused by name since 2026-09-19. Giving the slot a width here was tried and
// is wrong: the field `suspend.rs` actually builds is typed from the
// generator's `yield`s, so a different answer disagrees with it —
// `expected Int { bits: 32 }, found Float { bits: 64 }`.
function* silent(): Generator<never> {}

export function walkedSilently(n: number): number {
  let seen = 0;
  for (const _v of silent()) {
    seen = seen + 1;
  }
  return seen + n * 0;
}
