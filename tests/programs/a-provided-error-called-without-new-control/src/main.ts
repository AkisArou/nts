// From octane-splay: SplayTree#remove (benchmarks/cases/octane-splay/case.ts:216).
// Calling provided Error without new.
// Subject and control differ only by "Error(s)" -> "new Error(s)".
// Refusal subject: tests/refusals/a-provided-error-called-without-new.
export function probe(s: string): string {
  return new Error(s).message;
}
