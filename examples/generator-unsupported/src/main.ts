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

// A generator driven by what the caller sends, whose `yield` has **no operand**.
//
// `Generator<void, void, string>` takes its values *in* rather than handing
// them out, and this is the shape `runtime/node/readline`'s `emitKeys` has.
//
// **The refusal here changed on 2026-09-20 and the arm is kept for the new
// one.** It used to be `a generator that yields nothing` -- an element type of
// `void` or `never` left the frame's `yielded` slot with no width, and the
// abstract generator every frame extends could not be laid out. That is fixed:
// `suspend::yielded_slot` gives an uninhabited element a placeholder, asked by
// all four places that derive it. What is left is the **operand**: `yield;`
// with nothing after it is a suspension whose value is `undefined`, and
// `a `yield` of nothing` is a separate refusal with its own lowering behind it.
//
// So this arm now pins a narrower sentence than it was written for, which is
// the point of keeping it rather than deleting it: the two were one refusal and
// are two, and only one of them has gone.
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

// The `silent` generator that used to live here -- `function* silent():
// Generator<never> {}`, walked and reached by `next()` -- **moved to
// `examples/generators` on 2026-09-20**, because it compiles. Its two arms are
// `walkOverNoElement` and `doneFromTheStart` there, beside a generator method
// with an empty body, which is the shape the test262 corpus writes 156 times.
//
// An example named `-unsupported` is a claim about what a compiler refuses, and
// it goes stale in the one direction nobody watches: the construct starts
// working and the file keeps saying it does not. `tooling/gate/example-refusals`
// is what caught this -- it counts each fixture's refusals and reported
// `generator-unsupported refuses 3, down from 5 -- edit the table`.
