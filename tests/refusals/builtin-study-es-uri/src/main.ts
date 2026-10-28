// expect: lowers
//
// Builtins study probe es-uri; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: OK.
// In the control, only the string input changes to one requiring no escaping.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("u", encodeURIComponent("a b"), parseInt("12px"), parseFloat("1.5e3"));
}

export function control(): void {
  console.log("u", encodeURIComponent("ab"), parseInt("12px"), parseFloat("1.5e3"));
}
