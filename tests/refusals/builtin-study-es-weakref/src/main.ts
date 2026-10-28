// expect: NTS1001 a `new` of unrepresentable type (`WeakRef`) is not supported by this lowering yet
//
// Builtins study probe es-weakref; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`WeakRef`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed reference class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceRef<T> { constructor(private value: T) {} deref(): T { return this.value; } }

export function subject(): void {
  class K {} const k = new K(); const w = new WeakRef(k); console.log("w", w.deref() === k);
}

export function control(): void {
  class K {} const k = new K(); const w = new SourceRef(k); console.log("w", w.deref() === k);
}
