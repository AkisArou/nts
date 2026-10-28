// expect: NTS1001 a `new` of unrepresentable type (`WeakMap<an object, number>`) is not supported by this lowering yet
//
// Builtins study probe es-weakmap; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`WeakMap` with no recorded arguments) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the collection class changes from weak to ordinary Map.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  class K {} const w = new WeakMap<K, number>(); const k = new K(); w.set(k, 1); console.log("w", w.get(k));
}

export function control(): void {
  class K {} const w = new Map<K, number>(); const k = new K(); w.set(k, 1); console.log("w", w.get(k));
}
