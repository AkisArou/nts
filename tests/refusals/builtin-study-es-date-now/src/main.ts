// expect: NTS1100 `Date.now`
//
// Builtins study probe es-date-now. The unchanged input is original.ts; it is
// outside this project's include so its module-scope main() does not create a cut.
// Recorded C/LLVM/JVM verdict: PARTIAL (refused).
// Subject retains the original function body. In the control, the clock read is replaced by a fixed millisecond value.
// A source fallback is a call-shape control, not a builtin conformance claim.


export function subject(): void {
  console.log("d", Date.now() > 0);
}

export function control(): void {
  console.log("d", 1 > 0);
}
