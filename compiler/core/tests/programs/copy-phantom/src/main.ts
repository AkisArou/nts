// A function whose *structural copy* refuses while the plain body compiles.
//
// `uncompiled` is keyed by name and `note_uncompiled` records a copy under its
// own emitted name **and** under the declaration's bare one -- so the copy's
// refusal was published against the original, which is a different body and, as
// here, one that compiled. A reader asking why `hold` is missing gets an answer
// about a function that is present.
//
// The shape is `blockers/an-options-bag-widened-by-assignment` in miniature, and
// it is where the witness came from: `make@0obj6` refused, `func make(...)` was
// emitted, and the bare `make` row claimed the same reason. TypeScript's
// assignability for all-optional interfaces runs the opposite way to storage, so
// `Slim` is assignable to `Both` while holding one fewer field.

interface Bag {
  size?: number | undefined;
}

interface Slim extends Bag {
  level?: number | undefined;
}

interface Extra extends Bag {
  params?: number | undefined;
}

/** Three optional fields, so a `Slim` is assignable to it and has no slot. */
interface Both extends Slim, Extra {}

class Holder {
  readonly bag: Both;

  constructor(bag: Both) {
    this.bag = bag;
  }
}

function hold(bag: Both): Holder {
  return new Holder(bag);
}

/**
 * The control: a `Both` reaching a `Both` needs no cast, so the plain `hold`
 * compiles and the phantom has something to be a phantom *of*. Without this arm
 * the bare entry would be honest.
 */
export function fromBoth(bag: Both = {}): number {
  return hold(bag).bag.params ?? 0;
}

/** The subject: this asks for a copy of `hold`, and the copy cannot be lowered. */
export function fromSlim(bag: Slim = {}): number {
  return hold(bag).bag.params ?? 0;
}
