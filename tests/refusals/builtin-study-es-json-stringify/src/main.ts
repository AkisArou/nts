// expect: lowers
//
// Builtins study probe es-json-stringify; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `JSON.stringify`, a global member with no definition here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the stringify expression changes to a source property observation.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  const o = { a: 1, b: "x" }; console.log("j", JSON.stringify(o));
}

export function control(): void {
  const o = { a: 1, b: "x" }; console.log("j", o.b);
}
