// expect: NTS1001 a `new` of unrepresentable type (`Headers`) is not supported by this lowering yet
//
// Builtins study probe web-headers; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`Headers`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed headers class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceHeaders { private values = new Map<string, string>(); set(key: string, value: string): void { this.values.set(key, value); } get(key: string): string | undefined { return this.values.get(key); } }

export function subject(): void {
  const h = new Headers(); h.set("a", "b"); console.log("h", h.get("a"));
}

export function control(): void {
  const h = new SourceHeaders(); h.set("a", "b"); console.log("h", h.get("a"));
}
