// expect: a call inside a `try` whose `throw` would not reach this handler: an accessor, which is a call

// An accessor read inside a `try`. `examples/accessors` opens with the sentence
// this is about -- "an accessor looks like a property and **is** a call" -- and
// the guard that refuses a call inside a `try` did not know it.
//
// That guard matched `CallExpression` and `NewExpression`. A getter read is a
// `PropertyAccessExpression`, so `try { return c.checked } catch { }` compiled,
// the throw crossed the boundary the refusal exists to name, and the program
// **declined 6 of 29 cases** where node answers `-1`. A setter does the same
// under an assignment: `try { c.checked = n } catch { }`.
//
// Neither was reported. `emit-c` said nothing, the differential folds a decline
// into *skipped* rather than *disagreed*, and its last line read `agreed on
// every case` above `6 case(s) the compiled program declined`.
//
// It is the accessors example's own warning one level over. There it is about
// storage -- "laying `doubled` out as a field and emitting a load for
// `b.doubled` would read whatever happens to sit at that offset" -- and here it
// is about control flow, with the same cause: the thing reads as a property
// everywhere except where it matters.
//
// `reads_an_accessor` now answers by the member symbol's declarations, because
// nothing in the syntax of `c.checked` says which it is.
//
// # When this stops being the right answer
//
// Row 272 refuses a call inside a `try` because a `throw` lowers to a jump to
// the enclosing handler *block*, and a callee has no edge back to its caller's
// handler. When that changes, all three of these lower together and this
// fixture goes green -- there is nothing accessor-specific about the repair,
// only about the population of the guard.

// An explicit field rather than a parameter property: this directory's config
// sets `erasableSyntaxOnly`, under which `constructor(private v: number)` is
// TS1294 and the fixture would be a type error rather than a lowering one.
class Checked {
  private readonly value: number;

  constructor(value: number) {
    this.value = value;
  }

  get checked(): number {
    if (this.value < 0) {
      throw new Error("negative");
    }
    return this.value;
  }
}

class Stored {
  public value = 0;

  set checked(given: number) {
    if (given < 0) {
      throw new Error("negative");
    }
    this.value = given;
  }
}

export function aGetterInsideATry(n: number): number {
  const held = new Checked(n);
  try {
    return held.checked;
  } catch {
    return -1;
  }
}

export function aSetterInsideATry(n: number): number {
  const held = new Stored();
  try {
    held.checked = n;
    return held.value;
  } catch {
    return -1;
  }
}

// An ordinary field read in the same position, which must keep lowering -- the
// arm that fails if the guard is widened to every member access.
export function aFieldInsideATry(n: number): number {
  const held = new Stored();
  try {
    held.value = n;
    return held.value;
  } catch {
    return -1;
  }
}
