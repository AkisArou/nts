// `const xs: number[][] = [[1, 2], [3, 4]]` at module scope.
//
// **It emitted invalid HIR, and `emit-c` refused nothing.** `verify` reported
// three `StoreType`s -- an array element where `number[]` was expected and a
// `number[][]` was found -- which is the only reason the program did not simply
// run wrong.
//
// An array literal is built at the type of the slot it is going into, which is
// what makes an annotation work: the literal's own type is discarded when it
// disagrees with the slot, so that `readonly EventName[]` builds strings as
// `EventName` rather than rejecting them a line later. Lowering an *element*
// then has to narrow that expectation to the element type, and nothing did, so
// the inner `[1, 2]` was built against the outer slot -- a `number[][]` -- and
// stored into a slot holding `number[]`.
//
// Inside a function the same declaration was always fine, which is exactly what
// hid it: there nothing sets an expectation, so the literal keeps its own type
// and each level is right by default. The bug needed a slot with an annotation,
// and a module-scope `const` is where TypeScript programs put those.

const grid: number[][] = [
  [1, 2],
  [3, 4],
];

const pairs: [number, number][] = [
  [10, 20],
  [30, 40],
];

const deep: number[][][] = [
  [[1], [2]],
  [[3]],
];

const rows: { a: number }[] = [{ a: 5 }, { a: 6 }];

const words: string[][] = [
  ["a", "b"],
  ["c"],
];

export function fromAGrid(n: number): number {
  return grid[0][0] + grid[1][1] + n;
}

export function fromTuples(n: number): number {
  return pairs[0][0] + pairs[1][1] + n;
}

/** Three levels, because a fix that narrows one level would pass the two above
 *  and fail here. */
export function threeDeep(n: number): number {
  return deep[0][1][0] + deep[1][0][0] + n;
}

/** An array of objects, which was never broken and has to stay unbroken: its
 *  elements are built at a layout, and that is the path the narrowing runs
 *  through now. */
export function fromObjects(n: number): number {
  return rows[0].a + rows[1].a + n;
}

/** Elements that are not numbers, so a narrowing that hardcoded the element
 *  type rather than reading it would show here. */
export function fromWords(n: number): string {
  return words[0][1] + words[1][0] + n.toString();
}

/** Lengths, which is what a wrongly nested array would get right by accident
 *  and a wrongly *shaped* one would not. */
export function shapes(n: number): number {
  return grid.length * 100 + grid[0].length * 10 + deep[0].length + n;
}
