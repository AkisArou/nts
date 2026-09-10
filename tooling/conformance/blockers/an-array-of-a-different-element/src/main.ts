// expect: lowers
//
// **Kept as a guard, and fixed within the hour by the change it made possible.**
// Filing this refusal is what exposed the real defect: an array literal was
// built at the element type its own contents suggest and then *rejected* by the
// slot it was going into, when the slot's element type was available all along.
//
// `sumErased([1, 2, n])` now builds the literal at `Erased` because that is what
// the parameter holds. The refusal below still stands for the case it was
// written for -- an array that already exists, of the wrong element, handed to a
// slot that cannot take it -- and `subject` is no longer that case, because
// nothing exists before the slot is known.
//
// See `examples/an-array-literal-at-the-slots-element`, which asks node.
//
// **A blocker whose refusal replaced a verifier crash.** `number[]` is
// assignable to `readonly unknown[]` in TypeScript, and the two are different
// arrays here: eight bytes of `double` against a sixteen-byte `NtsValue`. A
// pointer to one is not a pointer to the other, and `coerce` passed it through.
//
// It did not become a wrong answer, because `hir::verify` catches it:
//
//     invalid HIR: CallArgumentType { func: "ask", callee: "fromArrayLike",
//       at: 0, expected: Managed(Array(Erased)),
//              found: Managed(Array(Float { bits: 64 })) }
//     Error: refusing to emit code from invalid HIR
//
// That is the right outcome arriving at the wrong end. It has no source
// location, it names the two `HirType`s and not the two element types the
// program wrote, and it stops the whole build rather than the one function —
// so a module with one of these reports nothing about the other twenty
// constructs it also contains.
//
// # What it is not
//
// Not the structural-cast case (`a-structural-cast-that-is-not-a-prefix`),
// which is one object read as another. This is one *array* read as another, and
// the requirement is stricter: an element is at `i * size`, so a prefix is not
// enough and only exact agreement will do.
//
// **Two structurally identical object types are exact agreement**, and refusing
// those was the first version's mistake: `Point` and the anonymous
// `{ x: number; y: number }` of a literal are one layout and two `TypeId`s.
// Three cases of `examples/destructuring` and one of `examples/objects` refused
// on it, caught by `tooling/gate/example-refusals` on the first gate-step run
// after the check went in. `control` below is that case and must keep
// compiling.
//
// # Why a refusal rather than a conversion
//
// A conversion is a copy and a copy is not the same object. `readonly` promises
// the callee will not write, which makes a copy *safe* and still leaves `===`
// answering differently. The same trade as the struct case, for the same reason.

function primitiveNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function sumErased(source: readonly unknown[]): number {
  let total = 0;
  for (let i = 0; i < source.length; i++) {
    total += primitiveNumber(source[i]) & 0xff;
  }
  return total;
}

export function subject(n: number): number {
  return sumErased([1, 2, n]);
}

/** The control: two names for one layout, which is exact agreement. */
interface Point {
  x: number;
  y: number;
}

function firstX(points: readonly Point[]): number {
  return points[0]?.x ?? -1;
}

export function control(n: number): number {
  return firstX([{ x: n, y: 1 }, { x: 2, y: 3 }]);
}
