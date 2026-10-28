// expect: NTS1001 a `for...of` over an object type is not supported by this lowering yet
//
// Builtins study probe es-array-from; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `for...of` over an object type | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the array-like input changes to an array with the same length.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("a", Array.from({ length: 3 }, (_, i) => i).join(","));
}

export function control(): void {
  console.log("a", Array.from([0, 0, 0], (_, i) => i).join(","));
}
