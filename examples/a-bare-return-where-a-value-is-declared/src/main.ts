// A bare `return;` in a function whose declared return type is not `void`.
//
// Legal TypeScript wherever the type admits `undefined`, and it terminated with
// `Terminator::Return(None)` against a signature returning `Erased`. `verify`
// refuses that -- `ReturnType { expected: Erased, found: None }` -- and `emit-c`
// writes nothing from a program that does not verify, so **one such function
// cost every other function beside it**. That is why this is an example rather
// than a blocker: the category is invalid HIR, which neither of the other two
// fixture kinds can express, and its cost is the whole program.
//
// Found by the conformance lane's full test262 census: one file in 29,586
// (`return/S12.9_A5.js`). The narrowness of that is the point -- the construct is
// ordinary and the corpus simply did not contain it, which is what a 29,586-file
// census is for and what no refusal count could have shown, since nothing here
// refuses.
//
// The value a bare `return` produces is [`absent_at`]'s to choose and not the
// `return`'s: one function answers "which op stands for an absence at this
// representation" for a written `undefined` and for this, so the two cannot come
// to disagree about a nullable pointer -- where the absence is a null address
// rather than a tag.
//
// **The controls are two and they bracket it.** A `void` function's bare return
// must still drop the value entirely, and the explicitly written `return
// undefined;` must still lower as it always did. Both compiled before this and
// must not move.

/// The subject, in the shape the census found: a bare `return` and nothing else.
function always(): number | undefined {
  return;
}

/// And the ordinary shape: a guard clause beside a real return.
function maybe(n: number): number | undefined {
  if (n < 0) {
    return;
  }
  return n * 2;
}

/// The same where the declared type is `unknown`, which erases for its own reason.
function unknownly(n: number): unknown {
  if (n < 0) {
    return;
  }
  return n + 1;
}

/// A nullable class, where the absence is a **null pointer** rather than a tagged
/// undefined -- the arm that says the value comes from the representation and not
/// from the keyword.
class Box {
  constructor(readonly held: number) {}
}

function boxed(n: number): Box | undefined {
  if (n < 0) {
    return;
  }
  return new Box(n * 5);
}

/// Control: a `void` function drops the value, and a bare return there is what it
/// always was.
function nothing(n: number): void {
  if (n < 0) {
    return;
  }
}

/// Control: the explicit spelling, which compiled before this change.
function explicitly(n: number): number | undefined {
  if (n < 0) {
    return undefined;
  }
  return n * 3;
}

export function aBareReturnAndNothingElse(n: number): number {
  const held = always();
  return held === undefined ? n : held;
}

export function aBareReturnBesideAValue(n: number): number {
  const held = maybe(n);
  return held === undefined ? -1 : held;
}

export function aBareReturnAtUnknown(n: number): number {
  const held = unknownly(n);
  return typeof held === "number" ? held : -2;
}

export function aBareReturnAtANullableClass(n: number): number {
  const held = boxed(n);
  return held === undefined ? -3 : held.held;
}

export function aBareReturnAtVoid(n: number): number {
  nothing(n);
  return n + 7;
}

export function undefinedWrittenOut(n: number): number {
  const held = explicitly(n);
  return held === undefined ? -4 : held;
}
