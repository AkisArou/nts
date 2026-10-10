// expect: emit-c -> invalid HIR: StoreType { func: "subject", what: "an array element read", expected: Float { bits: 64 }, found: Erased }
//
// A `number[]` stored as an element of an `unknown[]`, taken back out, cast to
// `unknown[]` and indexed: lowering types the element read as the original
// array's `f64`, and stores it into the `Erased` local the cast declares,
// without boxing it. `hir::verify` catches it, so this is a stopped build on
// every backend (C, LLVM, JVM alike) rather than a wrong answer. With
// `string[]` it is the same, `expected: Managed(String)`.
//
// node answers "3" for `subject(3)`.
//
// # Controls, each one difference from `subject`, each lowering cleanly
//
//   `held[0] as number[]`           the cast names the element the array has
//   `const h: unknown = xs;`        the array held in an `unknown`, not taken
//     `(h as unknown[])[0]`         out of an `unknown[]`
//
// And not a control: `const h: unknown = held[0]; (h as unknown[])[0]` fails
// the same way, so the second hop through a plain `unknown` does not shed
// what lowering believes about the element.
//
// Found writing the written-kind array guard for scalar 2f
// (`examples/an-array-of-written-kinds-read-back`), which reads each array
// through a plain `unknown` instead so as not to stand behind this.

export function subject(n: number): string {
  const xs: number[] = [n, 2];
  const held: unknown[] = [xs];
  const ys = held[0] as unknown[];
  return String(ys[0]);
}
