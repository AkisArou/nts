// A `number[][]` global whose inner arrays **narrow to `i32`**.
//
// This is the specialization half of what `examples/a-nested-array-literal`
// covers in lowering, and that example cannot reach it — which is the whole
// reason this file exists rather than two more arms over there.
//
// # What was wrong
//
// `elements::representations` narrows an array's storage from `double[]` to
// `int[]` when every value it can hold is a whole number. A **global** cannot
// take part: its type is declared once at lowering and never rewritten, so
// narrowing the array without narrowing the slot leaves a `[i32]` value in a
// `[f64]` global. `stored_into_a_global` exists to hold those back, and it read
// the element type of the array being stored and stopped there:
//
//     const xs: number[][] = [[1, 2]];
//
// anchors `[f64]` — the outer array's element — and says nothing about `f64`,
// so the **inner** literal narrowed while the global stayed `[[f64]]`:
//
//     invalid HIR: StoreType { func: "module#init", what: "a global",
//       expected: Array(Array(Float { bits: 64 })),
//       found:    Array(Array(Int { bits: 32, signed: true })) }
//
// Invalid HIR rather than a wrong answer, which is worse: `emit-c` prints
// `refusing to emit code from invalid HIR`, **writes nothing and exits 0**, so
// the program is silently unbuilt and no diagnostic names a line.
//
// # Why the existing nested-array example is blind to it
//
// Element facts are keyed on the **element type, program-wide** — one array of
// fractions anywhere costs every `number[]` in that program the narrowing, and
// `elements.rs` says so in as many words. Every arm in
// `a-nested-array-literal` adds its `n: number` parameter to an element, which
// reads `f64` into floating-point arithmetic and disqualifies it. So the pass
// under test never ran there, on any arm, and could not have.
//
// **Nothing in this file may do floating-point arithmetic on an element.** The
// parameter is used as a *selector* and as the right-hand side of a comparison,
// never as an operand of `+`. An arm that adds `n` to an element would disable
// the narrowing for the whole file and quietly turn every other arm into a test
// of nothing.

const grid: number[][] = [
  [1, 2],
  [3, 4],
];

const deep: number[][][] = [[[5], [6]], [[7]]];

/** Straight out of the inner array, with no arithmetic on the way. */
export function element(n: number): number {
  const row = grid[n < 1 ? 0 : 1];
  return row[n < 1 ? 1 : 0];
}

/** Three levels, because anchoring one level deep would pass `element`. */
export function threeDeep(n: number): number {
  return deep[n < 1 ? 0 : 1][0][0];
}

/** A comparison reads the element without widening the result. */
export function compared(n: number): boolean {
  return grid[0][0] < n;
}

/**
 * The shape, which a wrongly *nested* build gets wrong while still typechecking.
 */
export function shape(n: number): number {
  return grid.length * 100 + grid[0].length * 10 + deep[0].length + (n < 1 ? 0 : 1);
}

// # There is no flat `number[]` control in this file, deliberately
//
// One was written and it **hid the defect**. A flat `const flat: number[] =
// [8, 9]` anchors `f64` on its own, through the very line this change extends —
// and the facts are keyed on the element type program-wide, so that one global
// protects `grid`'s inner arrays too. With it the unfixed compiler emits C and
// every arm agrees; without it the unfixed compiler writes nothing.
//
// A control chosen because it exercises the neighbouring path can *be* the
// thing under test one level down. The flat shape is covered by
// `examples/module-evaluation` and `examples/an-out-of-range-read-the-program-handles`,
// which both declare a module-scope `number[]`, and it has to stay in a file
// that has no nested array in it.
