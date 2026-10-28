// expect: NTS1001 an `Object` static over something that is not an object here is not supported by this lowering yet
//
// Builtins study probe es-object-keys; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 an `Object` static over something that is not an object here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the widened dictionary annotation is removed.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  const o: Record<string, number> = { a: 1, b: 2 }; console.log("o", Object.keys(o).length, Object.entries(o).length);
}

export function control(): void {
  const o = { a: 1, b: 2 }; console.log("o", Object.keys(o).length, Object.entries(o).length);
}
