// expect: NTS1100 `globalThis`
//
// Builtins study probe es-globalthis; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `globalThis`, a namespace | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the global object binding changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

const sourceGlobal = { value: 1 };

export function subject(): void {
  console.log("g", typeof globalThis);
}

export function control(): void {
  console.log("g", typeof sourceGlobal);
}
