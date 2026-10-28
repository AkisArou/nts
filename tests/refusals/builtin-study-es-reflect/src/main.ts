// expect: NTS1001 `Reflect.has`
//
// Builtins study probe es-reflect; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Reflect.has`, which is prototype and descriptor reflection: a value's shape is fixed when it is laid out, so there is no prototype object to hold a property, no descriptor to redefine one with, and nothing that can be given a different shape at run time | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceHas(value: { a: number }, key: string): boolean { return key === "a" && value.a === 1; }

export function subject(): void {
  console.log("r", Reflect.has({ a: 1 }, "a"));
}

export function control(): void {
  console.log("r", sourceHas({ a: 1 }, "a"));
}
