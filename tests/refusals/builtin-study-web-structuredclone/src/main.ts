// expect: NTS1100 `structuredClone`
//
// Builtins study probe web-structuredclone; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `structuredClone`, a builtin this compiler does not provide | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceClone(value: { a: number }): { a: number } { return { a: value.a }; }

export function subject(): void {
  const o = structuredClone({ a: 1 }); console.log("s", o.a);
}

export function control(): void {
  const o = sourceClone({ a: 1 }); console.log("s", o.a);
}
