// expect: NTS1100 `queueMicrotask`
//
// Builtins study probe web-queuemicrotask. The unchanged input is original.ts; it is
// outside this project's include so its module-scope main() does not create a cut.
// Recorded C/LLVM/JVM verdict: PARTIAL (refused).
// Subject retains the original function body. In the control, only the callee changes from the ambient builtin to a source function.
// A source fallback is a call-shape control, not a builtin conformance claim.

function callInSource(callback: () => void): void { callback(); }

export function subject(): void {
  queueMicrotask(() => console.log("m"));
}

export function control(): void {
  callInSource(() => console.log("m"));
}
