// A generator declared as a **method**, which is how a class is made iterable.
//
//     class C { *[Symbol.iterator]() { yield 1 } }
//     for (const x of new C()) …
//
// This refused until 2026-09-11, and the message was true of the lowering and
// false of the source: *a `yield` outside a generator*, said of a `yield`
// written inside one. Not about symbol keys either -- a plainly named
// `*named()` said it too.
//
// # Three halves, and the middle one is why it took two attempts
//
// **The declaration.** `begin_generator` had one caller, `lower_function`, so a
// method reached its body with no frame reserved. Fifteen lines.
//
// **The call.** A generator's result is its *frame*, not the `Generator<T, …>`
// the checker says -- that interface describes an object this compiler does not
// build. The plain-call path reads the callee's declaration out of
// `call_targets`; a method call has a receiver type and a member name, and
// there was no route from those to a declaration node. So the first attempt was
// thrown away: it made the method compile and left it unreachable, which
// produces no event in any lane and would have read to a reader as the feature
// working.
//
// `PropertyRecord::declaration` is that route now. It went on the record rather
// than into a `(TypeId, member) -> NodeId` map beside it, and the reason is
// worth more than this feature: **ask what the fact is about.** "Where was this
// member declared" is about the member, and `PropertyRecord` is the member. The
// map would have been a second structure keyed by what the first is already
// keyed by.
//
// **The walk.** `for (const x of new C())` calls `[Symbol.iterator]()` and gets
// a frame back, which is *resumed* rather than having a `next` method. Asking
// the hierarchy for one answered `a method `next` with no declaration in the
// hierarchy` -- a true sentence about a question that should not have been
// asked. `protocol_walk` hands off to `generator_walk` at that point, and it has
// to be *after* the call is pushed, because a generator is walked where it was
// made and the resumption's name is derived from the call that made it.
//
// # What it is worth
//
// `Symbol.iterator` is 26 sites across `runtime/node`, `function*` 29 and
// `yield` 117 -- counted, and with `decodeURIComponent`'s 8 as the control,
// since that one gated `querystring.parse`.
//
// The JVM backend needed nothing, which that lane established before the work
// started rather than after: a generator is already a `<name>$frame` there and a
// frame captures its parameters as fields, so a method's `this` is one more
// reference field. All three backends agree on every case here.

/** Control: a generator function, which worked before any of this. */
function* plain(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

export function viaPlainFunction(n: number): number {
  let total = 0;
  for (const v of plain(n & 3)) total += v;
  return total;
}

class Counter {
  limit: number;
  step: number;

  constructor(limit: number) {
    this.limit = limit;
    this.step = 2;
  }

  /** Under test: a generator method with an ordinary name. */
  *named(): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i;
  }

  /**
   * Under test: symbol-keyed, which is what makes the class iterable.
   *
   * It reads `this.step` as well as `this.limit`, so a frame that captured the
   * receiver wrongly would answer a different number rather than crash.
   */
  *[Symbol.iterator](): Generator<number> {
    for (let i = 0; i < this.limit; i++) yield i * this.step;
  }
}

/** Under test: calling a generator method explicitly. */
export function viaNamedMethod(n: number): number {
  let total = 0;
  for (const v of new Counter(n & 3).named()) total += v;
  return total;
}

/** Under test: the implicit `[Symbol.iterator]()` a `for...of` calls. */
export function viaIterable(n: number): number {
  let total = 0;
  for (const v of new Counter(n & 3)) total += v;
  return total;
}

/**
 * Under test: two instances walked in one answer, so a frame that captured the
 * *wrong* receiver is visible. With one instance it could hold anything and
 * still agree.
 */
export function twoReceivers(n: number): number {
  let a = 0;
  for (const v of new Counter(n & 3)) a += v;
  let b = 0;
  for (const v of new Counter((n & 1) + 1)) b += v;
  return a * 100 + b;
}

/** Under test: a generator method on a subclass, which inherits nothing here. */
class Doubled extends Counter {
  constructor(limit: number) {
    super(limit);
    this.step = 4;
  }
}

export function throughASubclass(n: number): number {
  let total = 0;
  for (const v of new Doubled(n & 3)) total += v;
  return total;
}
