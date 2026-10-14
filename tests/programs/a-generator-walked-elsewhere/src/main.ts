// A generator walked somewhere other than where it was made.
//
//     function* upTo(n) { … }
//     function drain(g: Generator<number>) { for (const v of g) … }
//     drain(upTo(5))
//
// This refused until 2026-09-12, and it refused a step earlier than the loop:
// at the *parameter*, because `Generator<T, TReturn, TNext>` had no
// representation and a signature cannot name a type that has none.
//
// # What a generator is, and what it was missing
//
// Calling a generator runs none of its body; it produces its **frame**. A
// `for...of` over one is not a `next()` — the frame is *resumed*, and the
// resumption is a separate top-level function that `hir::suspend` splits out
// long after the loop is lowered. So the loop had to name the resumption
// statically, and it derived that name from the call that produced the frame.
//
// That is why the feature was missing rather than merely refused: a parameter
// has no call behind it to take a name from.
//
// # The prefix was already there
//
// Every generator frame begins with the same two fields — `state` and
// `yielded`, at 24 and 28 in the emitted C — and diverges only from 32 on,
// where the captured variables start. So the abstract generator does not need
// to be invented, only *named*: `Generator<T, …>` is laid out as exactly that
// prefix, by the same `generator_prefix` that lays out the frames, and a
// concrete frame is already a structural prefix of it.
//
// The checker's own id for `Generator<number>` is the class, rather than a
// synthetic band beside it. The checker has already decided that
// `Generator<number>` written in two files is one type, and a second identity
// for it would be a second derivation of a fact that already has one.
//
// # How the resumption travels
//
// Through the dispatch table the descriptor already carries. Each frame
// overrides the slot the abstract generator declares, so a walk that cannot see
// which body to resume loads one pointer and calls it:
//
//     v3 = ((bool (*)(NtsObj_Generator0 *))v0->header.descriptor->methods[0])(v0);
//
// and a walk that *can* see it still emits a direct call. That is not an
// optimisation applied afterwards. The JVM lane measured ART: no inline cache
// and **no free monomorphic case** — a virtual call is 1.88x to 2.06x a field
// read whether one class implements it or three, against 1.02x on HotSpot. This
// call is on the hot path of every element of every walk, so the direct form is
// kept where the generator was made locally and the indirect form is used only
// where the question cannot be answered statically.
//
// The abstract generator declares the resumption and defines nothing, which is
// `Func::abstract_declaration` — the same shape record 0090 describes for
// `abstract area(): number`, and for the same reason: the *caller* needs a
// declaration to take a signature from. Its body is `Unreachable`, which is the
// truth rather than a placeholder, because every receiver that exists is a
// frame whose override filled the slot.

/** Control: a generator walked where it was made, which always worked. */
function* upTo(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

export function walkedWhereMade(n: number): number {
  let total = 0;
  for (const v of upTo(n & 7)) total += v;
  return total;
}

/** Under test: the same generator, walked behind a parameter. */
function drain(g: Generator<number>): number {
  let total = 0;
  for (const v of g) total += v;
  return total;
}

export function walkedElsewhere(n: number): number {
  return drain(upTo(n & 7));
}

/**
 * A second generator with a **different body and the same frame shape**.
 *
 * One parameter, one `number`, one spilled value — so its frame is laid out
 * exactly like `upTo`'s and the two are told apart only by which resumption
 * their descriptor points at.
 */
function* downFrom(limit: number): Generator<number> {
  for (let i = limit; i > 0; i--) yield i;
}

/**
 * Under test, and the case that makes the dispatch observable.
 *
 * Both generators reach `drain` through one parameter. A walk that resolved the
 * resumption statically would call one body for both and still *run* — it would
 * simply answer `upTo`'s sum twice. Two shapes through one site is the only
 * arrangement where that is a different number rather than an invisible bug.
 */
export function twoGeneratorsOneWalk(n: number): number {
  const up = drain(upTo(n & 7));
  const down = drain(downFrom(n & 7));
  return up * 100 + down;
}

/** Under test: a generator that arrives as a return value rather than an argument. */
function chosen(n: number): Generator<number> {
  return n % 2 === 0 ? upTo(n & 7) : downFrom(n & 7);
}

/**
 * Under test: which generator it is depends on a value, so nothing static can
 * say which resumption this walk reaches.
 */
export function walkedFromAReturn(n: number): number {
  return drain(chosen(n));
}

/** Under test: a generator held in a local before it is walked. */
export function heldThenWalked(n: number): number {
  const held = upTo(n & 7);
  let total = 0;
  for (const v of held) total += v;
  return total;
}

/**
 * Under test: two independent walks of two frames of the *same* generator.
 *
 * A frame is per-call, so these must not share state. One generator reused
 * would answer the first sum and then zero.
 */
export function twoFramesOneGenerator(n: number): number {
  const first = drain(upTo(n & 7));
  const second = drain(upTo(n & 7));
  return first * 100 + second;
}

/**
 * Under test: a generator handed back by a function that is **not one**, and
 * walked at the call rather than through a parameter.
 *
 * This is the shape the name-from-the-call rule got wrong, and it got it wrong
 * by *looking right*: `relay(n)` is a direct call, so the walk took `relay` for
 * the generator and emitted a call to `relay__resume`, a function nothing
 * declares. `drain(chosen(n))` above does not reach it -- the frame arrives as
 * a parameter there, so the call is out of view and the dispatch runs. The two
 * differ only in whether a parameter stands between the call and the loop.
 *
 * It refused rather than mislinking, which is the only reason this was cheap to
 * find; the diagnostic named `relay__resume` and so named the mistake.
 */
function relay(n: number): Generator<number> {
  return upTo(n);
}

export function walkedStraightFromAReturn(n: number): number {
  let total = 0;
  for (const v of relay(n & 7)) total += v;
  return total;
}

/** Under test: the same, where which generator comes back is not static. */
export function walkedStraightFromAChoice(n: number): number {
  let total = 0;
  for (const v of chosen(n)) total += v;
  return total;
}
