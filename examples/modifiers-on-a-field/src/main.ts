// A property declaration with **two or more modifiers** lost its initialiser.
//
// The modifiers of a declaration occupy one slot and any number of children, and
// `child_slots` took one — so every slot after them shifted by one and the
// *name* came back as `readonly`. The lowering then looked up a field called
// `readonly`, found none, and dropped the initialiser in silence: no diagnostic,
// no store, and a field left holding the zero a fresh allocation has.
//
// **One modifier worked and none worked**, which is why nothing caught it: every
// fixture anyone had written used at most one. `internal/errors.ts` writes
// `override readonly code = "ERR_..."` on ninety-four classes, so every compiled
// error reached the host with no `code` at all — and 792 of node's own tests
// assert one.
//
// The cases below count modifiers rather than name them, because the count is
// the condition. `three` is not there for completeness: it is the case that says
// the repair consumes *every* modifier rather than two.

class NoModifier {
  a = "1";
}
class OneModifier {
  readonly a = "22";
}
class TwoModifiers {
  public readonly a = "333";
}
class TwoBase {
  public readonly a: string = "x";
}
class ThreeModifiers extends TwoBase {
  // Three on an *instance* field. A `static` one would be three too and would
  // be read as `a class used as a value`, which is a different gap and would
  // make this case refuse rather than compare.
  public override readonly a = "4444";
}
class Mixed {
  plain = "6";
  public readonly guarded = "77";
  // Read through a method, because `protected` is not readable from outside —
  // and a modifier that changes visibility is exactly the kind this dropped.
  protected readonly held = "888";
  reach(): number {
    return this.held.length;
  }
}

export function none(n: number): number {
  return new NoModifier().a.length + n;
}
export function one(n: number): number {
  return new OneModifier().a.length + n;
}
export function two(n: number): number {
  return new TwoModifiers().a.length + n;
}
export function three(n: number): number {
  return new ThreeModifiers().a.length + n;
}

/** Several on one class, so a fix that handles the first member only fails. */
export function mixed(n: number): number {
  const m = new Mixed();
  return m.plain.length * 100 + m.guarded.length * 10 + m.reach() + n;
}

/** The shape `internal/errors.ts` writes, which is what this was found through. */
abstract class NodeRangeError extends RangeError {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = "RangeError";
  }
}
class OutOfRange extends NodeRangeError {
  override readonly code = "ERR_OUT_OF_RANGE";
  constructor() {
    super("out of range");
  }
}

export function errorCode(n: number): number {
  return new OutOfRange().code.length + n;
}
export function errorName(n: number): number {
  return new OutOfRange().name.length + n;
}
