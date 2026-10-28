// expect: NTS1001 `localeCompare`
//
// Builtins study probe es-localecompare; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `localeCompare`, which a string does not have here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the locale comparison changes to a source comparison.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("i", "a".localeCompare("b"));
}

export function control(): void {
  console.log("i", ("a" < "b" ? -1 : 1));
}
