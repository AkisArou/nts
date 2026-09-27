// A value the checker narrowed by `instanceof`, then assigned to a new binding.
//
// Inside the branch every use of `b` has static type `Leaf` while the binding
// holds a `Base`. That disagreement used to be resolved per *use*, from the
// checker's type for that node, which has a path for a member read and none for an
// assignment -- so `const alias = b` reached `coerce` as a `Base` arriving where a
// `Leaf` is wanted, was refused, and its statement was cut. The program then ran
// on with whatever the target held, which is a different answer from node's.
//
// The licence is the test immediately above, so the branch rebinds once and every
// use in it is correct. A cast with no test above it is undominated and still
// refuses: `compiler/core/tests/programs/copy-phantom` is that shape, where
// TypeScript's structural assignability would otherwise have licensed reading a
// slot the value does not have.
//
// `aClosureWritesTheBinding` is the boundary, and it is here rather than in
// `blockers/` on purpose. A `let` a closure captures *and writes* is bound to its
// cell, so what the binding map holds there is the cell and not the value; a
// rebind that ignored that read the class's field out of the cell's own memory
// and **crashed** -- signal 11, on seventeen cases, silently. It is refused
// instead, and `tooling/gate/example-refusals` carries the count. If the guard is
// ever removed this example does not merely refuse less, it aborts, which is what
// makes it the right home for the hazard.

class Base {
  kind = 1;
}

class Leaf extends Base {
  extra = 2;
}

function make(): Base {
  return new Leaf();
}

/// The subject: the narrowed value assigned to a new binding, then read.
export function assignedToAConst(n: number): number {
  const b: Base = make();
  let out = 0;
  if (b instanceof Leaf) {
    const alias = b;
    out = alias.extra;
  }
  return out * 100 + n;
}

/// The control that always worked: the same read with no binding between.
export function readDirectly(n: number): number {
  const b: Base = make();
  let out = 0;
  if (b instanceof Leaf) {
    out = b.extra;
  }
  return out * 100 + n;
}

/// The narrowed value passed on, which is the same licence one step further.
function takes(leaf: Leaf): number {
  return leaf.extra;
}

export function passedAlong(n: number): number {
  const b: Base = make();
  let out = 0;
  if (b instanceof Leaf) {
    out = takes(b);
  }
  return out * 100 + n;
}

/// A `let` the arm reassigns: the narrowing ends there, and putting the binding
/// back must not undo the assignment.
export function reassignedInArm(n: number): number {
  let b: Base = make();
  let out = 0;
  if (b instanceof Leaf) {
    out = b.extra;
    b = new Base();
    out = out + b.kind;
  }
  return out * 100 + n;
}

/// The boundary: a `let` a closure writes to is bound to its cell, so the branch
/// does not rebind it and the assignment is refused, as it is everywhere else the
/// licence cannot be established. The read beside it still works.
export function aClosureWritesTheBinding(n: number): number {
  let b: Base = make();
  const reset = (): void => {
    b = new Base();
  };
  let out = 0;
  if (b instanceof Leaf) {
    const alias = b;
    out = alias.extra;
  }
  reset();
  return out * 100 + n + b.kind;
}

/// A closure made inside the arm, capturing the narrowed binding. The checker
/// types the capture by the narrowing, so this refused as "`b`, a `Base` captured
/// by a closure that reads it as a `Leaf`" -- a use the per-use path had no answer
/// for either, and one the rebind covers without knowing about closures.
export function capturedInArm(n: number): number {
  const b: Base = make();
  let out = 0;
  if (b instanceof Leaf) {
    const read = (): number => b.extra;
    out = read();
  }
  return out * 100 + n;
}

/// A closure made *before* the test and called inside it, so the capture is of the
/// unnarrowed binding while the call is dominated. Both must be right at once.
export function capturedOutside(n: number): number {
  const b: Base = make();
  const readKind = (): number => b.kind;
  let out = 0;
  if (b instanceof Leaf) {
    out = readKind() + b.extra;
  }
  return out * 100 + n;
}

/// And the arm that must keep answering from the base: no test, no narrowing.
export function withoutATest(n: number): number {
  const b: Base = make();
  return b.kind * 100 + n;
}
