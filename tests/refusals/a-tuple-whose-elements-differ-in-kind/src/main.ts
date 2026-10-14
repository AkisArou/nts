// expect: NTS1001 a `Counts` where a table is wanted -- one keeps its members as fields at fixed offsets and the other as keys looked up at run time, so a pointer to either is not a pointer to the other and every read through it finds nothing
//
// **A tuple whose elements differ in kind coerces both of them to one element
// type.** `[Map<string, number>, Counts]` refuses on `counts`, as "a `Counts` where
// a table is wanted"; the same pair written the other way round refuses on `table`,
// as "a table where a `Counts` is wanted". Neither element is wrong on its own and
// neither type is the cause: what decides it is **position**, and the arm that
// refuses is always the second one.
//
// That is what an *array-shaped* representation of a heterogeneous tuple looks like
// from the outside. A homogeneous tuple does represent as an array, deliberately --
// `[number, number]` is two doubles -- and a tuple whose elements disagree has to be
// an object of fields instead. Here the second element is being coerced to the
// first's type, which is the array rule reaching a tuple it does not fit.
//
// `readTheFirst` is the control and differs in one thing: the order of the two
// element types. A fixture with one order would have read as a fact about `Map`.
//
// **Older than the refusal that names it.** On a binary from before `7db48279c` (a
// struct pointer is not a table pointer) the same program refused as ``  `a`, where
// a `Map` or a `Set` has only `size` `` -- a read of `.a` on a value believed to be
// a map, which is this defect two steps later and reads as a missing `Map` member.
// That sentence still appears here, from the same cause.
//
// The GTK lane probed the neighbouring shape before building on it: a closure
// returning `[boolean, number]`, consumed both by index and destructured, is
// **correct** on all four arms (C and LLVM, plain and `--rc`). So this is keyed on
// an element whose representation is a managed object rather than on heterogeneity
// alone, which narrows where to look -- the rule that decides a tuple's
// representation, not the destructuring.

interface Counts {
  readonly a: number;
  readonly b: number;
}

const table = new Map<string, number>([["x", 1]]);
const counts: Counts = { a: 2, b: 3 };

function mapThenCounts(): [Map<string, number>, Counts] {
  return [table, counts];
}

export function readTheSecond(n: number): number {
  const [m, c] = mapThenCounts();
  return (m.get("x") ?? 0) * 100 + c.a * 10 + c.b + n;
}

/** **Control.** The same two types in the other order. */
function countsThenMap(): [Counts, Map<string, number>] {
  return [counts, table];
}

export function readTheFirst(n: number): number {
  const [c, m] = countsThenMap();
  return (m.get("x") ?? 0) * 100 + c.a * 10 + c.b + n;
}
