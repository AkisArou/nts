// expect: NTS1101 `eval`
//
// Builtins study probe es-eval; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `eval`, a builtin this compiler does not provide | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only dynamic evaluation changes to the equivalent source expression.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("e", eval("1+1"));
}

export function control(): void {
  console.log("e", (1 + 1));
}
