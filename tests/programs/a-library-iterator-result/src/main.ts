// `next(): IteratorResult<number>` — the spelling `lib.es2015.iterable.d.ts`
// gives every iterator, and the one this compiler could not represent.
//
//     NTS1001 a function returning a union of `IteratorReturnResult` |
//             `IteratorYieldResult` is not supported by this lowering yet
//
// The protocol itself was never the gap. `Walk::Protocol` calls `next()`, reads
// `done`, branches, and reads `value` on the not-done edge, and a *hand-written*
// `{ done: boolean; value: number }` result has always worked — `handWritten`
// below is that arm, and it is a control rather than a feature.
//
// # Why the library spelling is different
//
//     interface IteratorYieldResult<T>  { done?: false; value: T }
//     interface IteratorReturnResult<R> { done: true;   value: R }
//
// Two things stop a decomposition. `done?: false` is an **optional property**,
// which needs a presence bit and so changes a layout rather than adding to it;
// and `TReturn` defaults to `any`, which this compiler refuses on purpose.
//
// So the layout is *provided* rather than read, the way `builtin::error_fields`
// provides `Error`'s and for the reason its header already gives. One slot for
// `done`, one for the element — and neither blocker is worked around, because
// neither arm is ever decomposed and `TReturn` never gets a slot.
//
// # The one thing a provided layout cannot hold
//
// `{ done: true, value: undefined }` is how every iterator finishes, and a
// `number` slot has no room for `undefined`. The slot takes the element
// representation's **zero** instead, and that is only honest because nothing can
// read it:
//
//   - `for...of` reads `value` on the edge where `done` is false, by
//     construction;
//   - `r.value` in source is permitted only where the checker has already
//     narrowed `r` to the yield arm — which is TypeScript's own rule for
//     `IteratorResult`, not a second derivation of it;
//   - `const { value } = r` is refused outright, having no narrowed receiver
//     node to ask;
//   - `r.done = false` is refused, because it would move the guard without
//     moving what the slot holds.
//
// Every one of those was a probe against node before it was a rule. The
// destructuring path and the `done` write both **disagreed with node** — `0`
// where node says `undefined` — with the first refusal already in the tree and
// looking like it covered the question.

/** The library spelling, driven by `for...of`. */
class Counter {
  #n = 0;

  next(): IteratorResult<number> {
    this.#n = this.#n + 1;
    return this.#n > 3
      ? { done: true, value: undefined }
      : { done: false, value: this.#n };
  }

  [Symbol.iterator](): Counter {
    return this;
  }
}

export function summed(n: number): number {
  let total = 0;
  for (const v of new Counter()) {
    total = total + v * n;
  }
  return total;
}

/** A managed element, which needs no zero: `undefined` is a null reference. */
class Letters {
  #n = 0;

  next(): IteratorResult<string> {
    this.#n = this.#n + 1;
    return this.#n > 2
      ? { done: true, value: undefined }
      : { done: false, value: this.#n === 1 ? "a" : "b" };
  }

  [Symbol.iterator](): Letters {
    return this;
  }
}

export function joined(n: number): number {
  let text = "";
  for (const v of new Letters()) {
    text = text + v;
  }
  return text.length * n;
}

/** `if (!r.done)` — the checker narrows the union, which is the whole guard. */
export function guarded(n: number): number {
  const c = new Counter();
  const r = c.next();
  if (!r.done) {
    return r.value * n;
  }
  return -1;
}

/** The same proof arriving through an early return rather than a block. */
export function afterAnEarlyReturn(n: number): number {
  const c = new Counter();
  const r = c.next();
  if (r.done) {
    return -1;
  }
  return r.value * n;
}

/** The yield arm alone, which cannot be finished and so needs no guard. */
class Always {
  #n = 0;

  next(): IteratorYieldResult<number> {
    this.#n = this.#n + 1;
    return { done: false, value: this.#n };
  }
}

export function alwaysYielding(n: number): number {
  const a = new Always();
  return a.next().value * n + a.next().value;
}

/** Reading `done` alone, which never needed a proof. */
export function finishes(n: number): number {
  const c = new Counter();
  let steps = 0;
  while (!c.next().done) {
    steps = steps + 1;
  }
  return steps * n;
}

/**
 * **Control.** A hand-written result, which lowered before any of this and must
 * keep lowering unchanged — the provision is keyed by name, so a structurally
 * identical type must not pick it up.
 */
class Hand {
  #n = 0;

  next(): { done: boolean; value: number } {
    this.#n = this.#n + 1;
    return this.#n > 3 ? { done: true, value: 0 } : { done: false, value: this.#n };
  }

  [Symbol.iterator](): Hand {
    return this;
  }
}

export function handWritten(n: number): number {
  let total = 0;
  for (const v of new Hand()) {
    total = total + v * n;
  }
  return total;
}

/** **Control.** A generator, whose `Walk` is a frame rather than a protocol. */
function* upTo(limit: number): Generator<number> {
  for (let i = 1; i <= limit; i++) {
    yield i;
  }
}

export function generated(n: number): number {
  let total = 0;
  for (const v of upTo(3)) {
    total = total + v * n;
  }
  return total;
}

/** **Control.** A plain array walk, the path that must not move at all. */
export function overAnArray(n: number): number {
  const xs = [1, 2, 3];
  let total = 0;
  for (const v of xs) {
    total = total + v * n;
  }
  return total;
}
