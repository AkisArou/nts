// expect: NTS1100 `performance.now`
//
// Builtins study probe web-performance; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `performance.now`, a global member with no definition here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the clock read changes to a fixed monotonic value.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("p", performance.now() >= 0);
}

export function control(): void {
  console.log("p", 1 >= 0);
}
