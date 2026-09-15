// A user-defined type guard, **run** rather than only compiled.
//
// §6 has claimed `x is T` and `asserts x is T` since the table was written,
// citing `examples/advanced` — which declares `isFish(pet: Fish | Bird): pet is
// Fish` and is one of the nine examples the gate reports as having "compared
// nothing", because every export there takes an object. So the citation showed
// the syntax was accepted and no case had ever been compared against node.
//
// The checker resolves the narrowing and hands it to lowering through
// `node_types`, per node, rather than through `SignatureRecord::type_predicate`,
// which has no reader in core or codegen — see §16. That is what makes this
// worth running: the row is true for a reason other than the one its name
// suggests, and only a comparison shows the answer is right.

interface Circle {
  kind: "circle";
  r: number;
}

interface Square {
  kind: "square";
  s: number;
}

type Shape = Circle | Square;

/** The guard itself: a `boolean` to the machine, a narrowing to the checker. */
function isCircle(shape: Shape): shape is Circle {
  return shape.kind === "circle";
}

/** Both branches, so a guard stuck at `true` fails half the cases. */
export function throughAGuard(n: number): number {
  const shape: Shape =
    (n & 1) === 0 ? { kind: "circle", r: n & 7 } : { kind: "square", s: n & 7 };
  if (isCircle(shape)) {
    return shape.r * shape.r;
  }
  return shape.s * 4;
}

/** Negated, which narrows the *other* way in the else branch. */
export function throughANegatedGuard(n: number): number {
  const shape: Shape =
    (n & 2) === 0 ? { kind: "circle", r: n & 15 } : { kind: "square", s: n & 15 };
  if (!isCircle(shape)) {
    return shape.s + 1000;
  }
  return shape.r + 1;
}

/** An `asserts` predicate narrows for the rest of the scope rather than inside
 * a branch, and returns `void`. */
function assertCircle(shape: Shape): asserts shape is Circle {
  if (shape.kind !== "circle") {
    throw new Error("not a circle");
  }
}

export function throughAnAssertion(n: number): number {
  const shape: Shape = { kind: "circle", r: n & 31 };
  assertCircle(shape);
  return shape.r * 2;
}
