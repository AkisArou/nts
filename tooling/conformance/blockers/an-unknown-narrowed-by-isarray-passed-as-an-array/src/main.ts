// expect: NTS1001 an erased value where a concrete representation is wanted
//
// **An `unknown` narrowed by `Array.isArray` is refused where it is passed to
// a parameter typed as an array of `unknown`.** `reconcile`'s `count(child)`
// is the refused argument; the `Array.isArray` test above it lowers.
// `Array.isArray` leaves the narrowed value erased, so that it reads any array
// (outcomes/a-write-through-unknown-cast-to-an-array-of-unknown); `count` wants
// a laid-out array of erased values, and nothing converts the one into the
// other. The refusal drops the module's evaluation whole: the program prints
// nothing, and node prints `3` and `-1`.
//
// **Control**, measured and not kept in this file: the same program with the
// argument written `count(child as readonly Child[])`, a one-line difference.
// It compiles on both compilers below and prints node's lines, because the
// array it is given holds erased values. Given a `number[]`, the cast stops at
// run time by name ("an array read as `unknown[]` whose elements are not
// erased values"), as the outcome fixture above pins, so the cast is a
// control here and not a fix.
//
// **Measured the same** on da4a2a4a8 and efc71ad44: it is older than part 2's
// stage B.
//
// **Found by the React lane.** ReactChildFiber.ts:1510 is this shape:
// `reconcileChildFibersImpl` passes the narrowed `newChild` to
// `reconcileChildrenArray(..., newChildren: readonly Child[], ...)`, with
// `type Child = unknown`. It is the one root inside
// `reconcileChildFibersImpl`, and in the GTK counter's build 44 functions are
// refused through it: `reconcileChildFibers`, the `mountChildFibers` and
// `reconcileChildFibers` closures, and `reconcileChildren` and the rest of
// beginWork that places a component's children. The counter's chain from
// `main` stops before it today, at the LazyComponent root
// (blockers/a-generic-interface-whose-member-returns-its-type-parameter).
type Child = unknown;

function count(children: readonly Child[]): number {
  return children.length;
}

function reconcile(child: Child): number {
  if (Array.isArray(child)) {
    return count(child);
  }
  return -1;
}

const children: Child[] = ["a", 1, null];
console.log(reconcile(children));
console.log(reconcile("x"));
