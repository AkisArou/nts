// expect: NTS1100 `fetch`
//
// Builtins study probe web-fetch. The unchanged input is original.ts; it is
// outside this project's include so its module-scope main() does not create a cut.
// Recorded C/LLVM/JVM verdict: PARTIAL (refused).
// Subject retains the original function body. In the control, only the callee changes from the ambient builtin to a source function.
// A source fallback is a call-shape control, not a builtin conformance claim.

function providedFetch(_url: string): Promise<{ status: number }> {
  return Promise.resolve({ status: 200 });
}

export function subject(): void {
  fetch("http://127.0.0.1:9/").then((r) => console.log("f", r.status), () => console.log("f", "failed"));
}

export function control(): void {
  providedFetch("http://127.0.0.1:9/").then((r) => console.log("f", r.status), () => console.log("f", "failed"));
}
