// expect: NTS1100 `JSON.parse`
//
// Builtins study probe es-json-parse. The unchanged input is original.ts; it is
// outside this project's include so its module-scope main() does not create a cut.
// Recorded C/LLVM/JVM verdict: PARTIAL (refused).
// Subject retains the original function body. In the control, only the JSON parser call changes to the literal value it would parse.
// A source fallback is a call-shape control, not a builtin conformance claim.


export function subject(): void {
  const v: unknown = JSON.parse("[1,2]"); console.log("j", typeof v);
}

export function control(): void {
  const v: unknown = [1, 2]; console.log("j", typeof v);
}
