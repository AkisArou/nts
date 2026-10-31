// expect: NTS1001 `Error`, a class this compiler provides, called without `new` is not supported by this lowering yet
// From octane-splay: SplayTree#remove (benchmarks/cases/octane-splay/case.ts:216).
// Calling provided Error without new.
// Subject and control differ only by "Error(s)" -> "new Error(s)".
// Executable control: tests/programs/a-provided-error-called-without-new-control.
export function probe(s: string): string {
  return Error(s).message;
}
