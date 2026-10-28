// expect: NTS1001 `normalize`
//
// Builtins study probe es-normalize; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `normalize`, which a string does not have here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the string method changes to a provided source-preserving operation.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("n", "é".normalize("NFC").length);
}

export function control(): void {
  console.log("n", "é".slice(0).length);
}
