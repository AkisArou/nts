// `x?.m()` where `m` returns `void`.
//
// The optional call is `undefined` when the receiver is nullish and `void` when
// it ran, so its type is `undefined | void` -- **one absence written twice**.
// `absence_of_member` maps both to `Absence::Undefined` and the union arm's own
// comment says so, and then the arm answered "no representation" because no
// *non*-absent member was left. `lower_branching_value` needs one for the merge
// parameter of the conditional an optional chain lowers to, so the whole
// expression was refused: 597 sites over 51 distinct locations across 26
// modules, always this shape -- `controller?.abort()`,
// `capability?.resolve()`, `this.#observer?.(size)`.
//
// **The interesting arm is `whetherItRan`.** A void function returns
// `undefined`, so `s?.take(v) === undefined` is `true` whether the call
// happened or not -- an optional call cannot report whether it ran. That is
// node's answer and it has to be this compiler's, which is why the case is here
// rather than left to the shape that discards the result.

class Sink {
  seen = 0;
  take(v: number): void {
    this.seen += v;
  }
}

/** The shape every one of the 51 real sites has: the result is discarded. */
export function discardsTheResult(n: number): number {
  const s: Sink | null = (n & 1) === 0 ? new Sink() : null;
  s?.take(n & 7);
  return s === null ? -1 : s.seen;
}

/** Called twice through the same optional receiver, so the effect accumulates
 *  when it runs and nothing happens when it does not. */
export function twiceThroughTheSameReceiver(n: number): number {
  const s: Sink | null = (n & 2) === 0 ? new Sink() : null;
  s?.take(n & 3);
  s?.take(n & 3);
  return s === null ? 0 : s.seen;
}

/** `undefined` either way, which is the answer that could have gone wrong. */
export function whetherItRan(n: number): number {
  const s: Sink | null = (n & 1) === 0 ? new Sink() : null;
  const r = s?.take(n & 7);
  return r === undefined ? 1 : 0;
}

/** An optional call through a function-valued **field**, which is how
 *  `this.#pendingDataObserver?.(size)` and `this.#resumeSource?.()` are written
 *  at the real sites. Fired once with the field null and once with it set, so
 *  both paths of the conditional run. */
class Watcher {
  seen = 0;
  observer: ((v: number) => void) | null = null;
  fire(v: number): void {
    this.observer?.(v);
  }
}

export function throughAnOptionalFunctionField(n: number): number {
  const w = new Watcher();
  w.fire(n & 7);
  const before = w.seen;
  w.observer = (v: number): void => {
    w.seen = v + 1;
  };
  w.fire(n & 7);
  return before * 100 + w.seen;
}

// Not here, and deliberately: a nullable closure written as a **conditional
// expression** -- `(n & 4) === 0 ? (v: number): void => {} : null` -- is
// `an object type with no layout`, which is a separate gap this change does not
// touch. A fixture asserting a pass the change does not deliver is worse than no
// fixture.
