// expect: NTS1100 `Temporal.Now`
//
// Builtins study probe es-temporal; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Temporal`, a namespace | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the clock expression changes to a fixed epoch value.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("t", Temporal.Now.instant().epochMilliseconds > 0);
}

export function control(): void {
  console.log("t", 1 > 0);
}
