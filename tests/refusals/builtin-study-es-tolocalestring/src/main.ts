// expect: NTS1001 `toLocaleString`
//
// Builtins study probe es-tolocalestring; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `toLocaleString` on a number | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the formatting method changes to ordinary number formatting.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("i", (1234.5).toLocaleString("en-US"));
}

export function control(): void {
  console.log("i", (1234.5).toString());
}
