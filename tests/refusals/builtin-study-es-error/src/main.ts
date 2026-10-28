// expect: lowers
//
// Builtins study probe es-error. The unchanged input is original.ts; it is
// outside this project's include so its module-scope main() does not create a cut.
// Recorded C/LLVM/JVM verdict: OK.
// Subject retains the original function body. In the control, only the thrown error class changes; the TypeError test is unchanged.
// A source fallback is a call-shape control, not a builtin conformance claim.


export function subject(): void {
  try { throw new TypeError("x"); } catch (e) { console.log("e", e instanceof TypeError); }
}

export function control(): void {
  try { throw new Error("x"); } catch (e) { console.log("e", e instanceof TypeError); }
}
