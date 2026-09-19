// Generators: `function*` and `yield`, walked by a `for...of`.
//
// The state machine is the one `async` already had. What differs is who
// resumes it: an `await` subscribes to a promise and comes back from the event
// loop, a `yield` returns to the caller that is standing there waiting. So the
// suspension is an ordinary `return`, the frame *is* the iterator, and one step
// is one call and one field read -- nothing allocated per element.

function* upTo(limit: number): Generator<number, void, unknown> {
  // Clamped, and the clamp is about the *harness* rather than about
  // generators.
  //
  // `nts check` sweeps each parameter through a deliberately hostile pool that
  // contains 2^31, 2^32 and 2^53. Those are useful as values and useless as a
  // loop bound: a walk to 2^31 through a generator -- a state machine with a
  // heap frame per resumption -- does not finish on either side, so both are
  // killed at twenty seconds and the case is *abandoned*. An abandoned case is
  // scored as neither agreement nor disagreement; it buys nothing but wall
  // clock, and this file was buying 361 seconds of it, which the gate then pays
  // five times over because five backend lanes run the same examples.
  //
  // Clamping does not weaken the fixture, it strengthens it: the same case is
  // now *checked* rather than abandoned, and node computes the clamped answer
  // exactly as the compiled program does. Sixty-four is past every interesting
  // boundary this file has -- the two-state generator, the early stop, the
  // nested walk -- and small enough to finish instantly.
  //
  // `NaN > 64` is false, so a `NaN` limit keeps its old behaviour of running no
  // iterations, which is what `i < NaN` did before. A negative limit is
  // likewise unchanged.
  const bound = limit > 64 ? 64 : limit;
  let i = 0;
  while (i < bound) {
    yield i;
    i = i + 1;
  }
}

export function total(limit: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    sum = sum + value;
  }
  return sum;
}

// Nothing at all. The first resumption runs to the end and answers done, so
// the body never runs -- which is the case a walk that tested `done` after the
// body would get wrong.
function* nothing(limit: number): Generator<number, void, unknown> {
  if (limit > 1000000) {
    yield 1;
  }
}

export function emptyWalk(limit: number): number {
  let count = 0;
  for (const value of nothing(limit)) {
    count = count + value + 1;
  }
  return count;
}

// One `yield` and no loop: two states, and the second is the end.
function* justOne(n: number): Generator<number, void, unknown> {
  yield n * 2;
}

export function singleton(n: number): number {
  let seen = 0;
  let sum = 0;
  for (const value of justOne(n)) {
    seen = seen + 1;
    sum = sum + value;
  }
  return sum * 10 + seen;
}

// Two suspensions in a row, so the dispatch has three states and the value
// live across each is a different one.
function* pair(a: number, b: number): Generator<number, void, unknown> {
  const first = a + 1;
  yield first;
  const second = b + first;
  yield second;
}

export function twoStates(a: number, b: number): number {
  let out = 0;
  for (const value of pair(a, b)) {
    out = out * 100 + value;
  }
  return out;
}

// `break` leaves the generator suspended. Nothing resumes it again, which is
// what a walk that closed its iterator would have to do differently.
export function stopEarly(limit: number, stop: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    if (value >= stop) {
      break;
    }
    sum = sum + value;
  }
  return sum;
}

// `continue` has to reach the resumption. A cursorless walk keeps its step in
// the header for exactly this reason: a latch of its own would step nothing
// and the loop would spin.
export function skipping(limit: number): number {
  let sum = 0;
  for (const value of upTo(limit)) {
    if (value % 2 === 0) {
      continue;
    }
    sum = sum + value;
  }
  return sum;
}

// A `return` inside the body, which leaves the walk without finishing it.
export function firstOver(limit: number, floor: number): number {
  for (const value of upTo(limit)) {
    if (value > floor) {
      return value;
    }
  }
  return -1;
}

// Two walks over two frames at once. Each has its own state, so an
// implementation that kept the cursor anywhere but the frame gets this wrong.
export function nested(outer: number, inner: number): number {
  let sum = 0;
  for (const a of upTo(outer)) {
    for (const b of upTo(inner)) {
      sum = sum + a * b;
    }
  }
  return sum;
}

// A generator whose element is not a number.
function* words(n: number): Generator<string, void, unknown> {
  // Bounded for the reason `upTo` is, and more sharply: each iteration builds a
  // string, so a hostile bound exhausts memory before it exhausts the clock.
  const bound = n > 32 ? 32 : n;
  let i = 0;
  while (i < bound) {
    yield "w" + i;
    i = i + 1;
  }
}

export function joined(n: number): string {
  let out = "";
  // Bounded: the pool hands this negative, fractional and very large values,
  // and a string built from an unbounded one is megabytes the differential
  // then has to compare character by character.
  for (const word of words(n % 8)) {
    out = out + word + ".";
  }
  return out;
}

// The frame in a `const` first. It is the same SSA value, so the walk finds the
// call behind it and the loop is identical.
export function throughAName(limit: number): number {
  const walk = upTo(limit);
  let sum = 0;
  for (const value of walk) {
    sum = sum + value;
  }
  return sum;
}

// Walked twice. The second walk resumes a frame that already answered done, so
// it yields nothing -- which is what node does, and is the reason a generator
// is not an iterable you can restart.
export function twice(limit: number): number {
  const walk = upTo(limit);
  let first = 0;
  for (const value of walk) {
    first = first + value;
  }
  let second = 0;
  for (const value of walk) {
    second = second + 1;
  }
  return first * 1000 + second;
}

// Two calls, two frames, walked one after the other.
export function twoFrames(a: number, b: number): number {
  let sum = 0;
  for (const value of upTo(a)) {
    sum = sum + value;
  }
  for (const value of upTo(b)) {
    sum = sum + value * 100;
  }
  return sum;
}

// A parameter read after the suspension, so it has to be in the frame rather
// than in a C local that the return threw away.
function* strided(from: number, step: number, count: number): Generator<number, void, unknown> {
  // `count` is the bound; `from` and `step` are values and stay unclamped, so
  // the hostile pool still reaches the arithmetic this generator exists to
  // check -- 2^53 as a starting point, a negative stride, a NaN step.
  const bound = count > 64 ? 64 : count;
  let made = 0;
  let at = from;
  while (made < bound) {
    yield at;
    at = at + step;
    made = made + 1;
  }
}

export function strideSum(from: number, step: number, count: number): number {
  let sum = 0;
  for (const value of strided(from, step, count)) {
    sum = sum + value;
  }
  return sum;
}

// A generator that yields from inside a nested block and a `for` loop, so the
// suspension is not at the top level of the body.
function* triangle(rows: number): Generator<number, void, unknown> {
  // Bounded like the others, and this one quadratically: `rows` rows yield
  // `rows * (rows + 1) / 2` values, so a hostile bound is worse here than
  // anywhere else in the file.
  const bound = rows > 24 ? 24 : rows;
  for (let row = 0; row < bound; row = row + 1) {
    for (let col = 0; col <= row; col = col + 1) {
      yield row * 10 + col;
    }
  }
}

export function triangleSum(rows: number): number {
  let sum = 0;
  for (const value of triangle(rows)) {
    sum = sum + value;
  }
  return sum;
}

// A `return` in the generator, which ends the walk. What it returns is the
// `TReturn` of `Generator<T, TReturn>` and a `for...of` discards it.
function* untilNegative(a: number, b: number, c: number): Generator<number, void, unknown> {
  yield a;
  if (b < 0) {
    return;
  }
  yield b;
  if (c < 0) {
    return;
  }
  yield c;
}

export function beforeNegative(a: number, b: number, c: number): number {
  let count = 0;
  let sum = 0;
  for (const value of untilNegative(a, b, c)) {
    count = count + 1;
    sum = sum + value;
  }
  return count * 1000000 + sum;
}

// # `g.next()` — the generator held rather than walked
//
// A `for...of` never calls `next()`: the frame is *resumed*, and the resumption
// answers whether the generator finished while leaving the element in the
// frame's `yielded` slot. `a-generator-method` recorded that as
//
//   > exactly the two halves of an `IteratorResult` — so what is missing is not
//   > the step but the *object*
//
// and the object arrived on 2026-09-19, when `IteratorResult<T>` became a
// provided layout. This is the step it was waiting for.
//
// # Two things the HIR had to be read for
//
// **The resumption answers `done`, not "produced a value".** `walk_condition`
// runs a generator loop while `!at`, where `at` is exactly this call's result;
// inverting it here made every arm answer the opposite. The emitted resumption
// agrees — it sets the frame's state to `-1` and returns `true` on the path
// that finishes.
//
// **The resumption is named two ways**, and asking again here got it wrong.
// `generator_walk` already decides between a direct name — for a frame made by
// a call in this function — and a dispatch through a slot. Calling
// `generator_dispatch` unconditionally instead wanted a *layout* for the frame,
// and a frame made here has a synthetic type the snapshot has never heard of,
// so `const g = upto(n); g.next()` refused with `an object type that is not in
// the snapshot`. `nextOnAParameter` is the arm on the other side of that
// decision.
//
// # What `value` holds when it is done
//
// Whatever the generator last left in `yielded`, stored unconditionally.
// Nothing can read it: `.value` is permitted only where the checker has ruled
// the finished arm out, which is the same guarantee the `{ done: true, value:
// undefined }` zero rests on, reached from the other side.
//
// `next(v)` — sending a value into a suspended `yield` — is refused by name.
// The resumption has no parameter for it and dropping it would be a wrong
// answer.

function* threeFrom(n: number): Generator<number> {
  yield n;
  yield n + 1;
  yield n + 2;
}

export function nextOnce(n: number): number {
  const r = threeFrom(n).next();
  return r.done ? -1 : r.value;
}

export function nextTwice(n: number): number {
  const g = threeFrom(n);
  const a = g.next();
  const b = g.next();
  return (a.done ? 0 : a.value) * 100 + (b.done ? 0 : b.value);
}

/** Driven to exhaustion, which is the shape a hand-written walk takes. */
export function nextUntilDone(n: number): number {
  const g = threeFrom(n);
  let total = 0;
  for (;;) {
    const r = g.next();
    if (r.done) {
      return total;
    }
    total += r.value;
  }
}

/** `done` stays true once it is true. */
export function doneStaysDone(n: number): number {
  const g = threeFrom(n);
  g.next();
  g.next();
  g.next();
  const a = g.next();
  const b = g.next();
  return (a.done ? 1 : 0) + (b.done ? 2 : 0);
}

/**
 * **The other side of the naming decision.** A generator that arrived has no
 * call here to take a resumption name from, so it dispatches through a slot.
 */
function firstOf(g: Generator<number>): number {
  const r = g.next();
  return r.done ? -1 : r.value;
}

export function nextOnAParameter(n: number): number {
  return firstOf(threeFrom(n));
}

/** A reference element, so `yielded` is not always a number. */
function* twoWords(n: number): Generator<string> {
  yield "a" + n;
  yield "b";
}

export function nextOnStrings(n: number): number {
  const g = twoWords(n);
  const a = g.next();
  const b = g.next();
  return (a.done ? 0 : a.value.length) * 10 + (b.done ? 0 : b.value.length);
}

/** **Control.** The walk, which must be unchanged by any of this. */
export function walkedAsBefore(n: number): number {
  let total = 0;
  for (const v of threeFrom(n)) {
    total += v;
  }
  return total;
}

// # A generator that yields nothing
//
// `function* g() {}` is ordinary JavaScript: it returns an iterator that is
// immediately done. The checker types its element `never`, and
// `Generator<void, …>` — driven entirely by what the caller passes to
// `next(v)` — is the other spelling of the same thing. Both were **refused by
// name** until 2026-09-20, which was 176 files of the slice-1 `test/language`
// population.
//
// Neither can ever fill the frame's `yielded` slot, and a layout has a fixed
// shape, so the slot exists and has to have a width. `suspend::yielded_slot`
// is that rule and it is asked in **four** places — whether `Generator<T>`
// represents at all, the concrete frame's slot, the read out of the frame, and
// the abstract `Generator<…>` a frame extends — plus the `IteratorResult`
// layout whose `value` receives what the slot holds. A placeholder applied to
// fewer than all of them is a store and a load that disagree, and the first
// attempt at this failed exactly that way: two of them gave `BrokenBase
// { layout: "silent#frame", base: "Generator0" }` and one gave `StoreType
// { expected: Int { bits: 32 }, found: Float { bits: 64 } }`.
//
// Nothing can read the slot. `refuse_unguarded_iterator_value` permits a
// `.value` read only where the checker has ruled the finished arm out, and for
// an uninhabited element that narrowing gives a value of type `never`.
//
// **Not the same as `nothing(limit)` above**, which is the arm that already
// existed. That one has element type `number` and a real slot, and happens to
// yield nothing *at runtime* behind a guard no caller satisfies. This one has
// no element type at all, so there is no slot to have unless something invents
// one — and that is the whole of the difference, which is why the existing arm
// lowered for as long as this one refused.

function* noElementAtAll(): Generator<never, void, unknown> {}

/** The walk runs zero times, which is the whole observable behaviour. */
export function walkOverNoElement(n: number): number {
  let count = 0;
  for (const v of noElementAtAll()) {
    count++;
  }
  return count + n;
}

/** `next()` on it answers done immediately, and keeps answering done. */
export function doneFromTheStart(n: number): number {
  const it = noElementAtAll();
  const first = it.next().done ? 1 : 0;
  const second = it.next().done ? 1 : 0;
  return first * 10 + second + n;
}

let bodyRan = 0;

function* withAnEffect(): Generator<never, void, unknown> {
  bodyRan = 1;
}

/**
 * The body still runs. A generator that yields nothing is not a generator that
 * *does* nothing, and an implementation that skipped the frame would pass
 * `emptyWalk` and fail here.
 */
export function theBodyStillRuns(n: number): number {
  bodyRan = 0;
  for (const v of withAnEffect()) {
    // nothing
  }
  return bodyRan + n;
}

/**
 * A generator **method** with an empty body, which is the shape the corpus
 * writes — 78 files each in `expressions/class` and `statements/class`.
 */
class Empty {
  *rows(): Generator<never, void, unknown> {}
}

export function anEmptyGeneratorMethod(n: number): number {
  let count = 0;
  for (const v of new Empty().rows()) {
    count++;
  }
  return count + n;
}

/**
 * `Generator<never>` — the **short spelling**, with the other two arguments
 * left to their defaults. It moved here from `examples/generator-unsupported`
 * on 2026-09-20 when it started compiling, and it is a separate arm from
 * `noElementAtAll` above because the number of type arguments written is what
 * `type_arguments` hands back: a rule reading the first of three and a rule
 * reading the first of one are the same rule only if the checker fills the
 * defaults in, which is a fact about the frontend rather than an assumption to
 * make.
 */
function* silent(): Generator<never> {}

export function shortSpellingWalk(n: number): number {
  let seen = 0;
  for (const v of silent()) {
    seen = seen + 1;
  }
  return seen + n * 0;
}

export function shortSpellingNext(n: number): number {
  const r = silent().next();
  return (r.done ? 1 : 0) + n * 0;
}
