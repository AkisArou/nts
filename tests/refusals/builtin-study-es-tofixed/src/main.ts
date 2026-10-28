// expect: lowers
//
// Builtins study probe es-tofixed; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: OK.
// In the control, only the requested precision changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("n", (1.005).toFixed(2), (255).toString(16));
}

export function control(): void {
  console.log("n", (1.005).toFixed(1), (255).toString(16));
}
