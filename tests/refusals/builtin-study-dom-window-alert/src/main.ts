// expect: NTS1100 `alert`
//
// Builtins study probe dom-window-alert; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `alert`, a builtin this compiler does not provide | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceAlert(message: string): string { return message; }

export function subject(): void {
  alert("x");
}

export function control(): void {
  sourceAlert("x");
}
