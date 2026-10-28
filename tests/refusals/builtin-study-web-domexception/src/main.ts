// expect: NTS1001 a `new` of unrepresentable type (`DOMException`) is not supported by this lowering yet
//
// Builtins study probe web-domexception; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`DOMException`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed exception class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceException { constructor(public message: string, public name: string) {} }

export function subject(): void {
  const e = new DOMException("m", "AbortError"); console.log("d", e.name);
}

export function control(): void {
  const e = new SourceException("m", "AbortError"); console.log("d", e.name);
}
