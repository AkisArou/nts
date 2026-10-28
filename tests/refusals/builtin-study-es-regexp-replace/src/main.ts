// expect: NTS1001
//
// Builtins study probe es-regexp-replace; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a regular expression literal, which needs a regular expression engine | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the regular-expression argument changes to a string search.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("re", "xax".replace(/x/g, "y"));
}

export function control(): void {
  console.log("re", "xax".replace("x", "y"));
}
