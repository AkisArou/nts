// expect: NTS1001 a `new` of unrepresentable type (`URLSearchParams`) is not supported by this lowering yet
//
// Builtins study probe web-urlsearchparams; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`URLSearchParams`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed parameters class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceParams { constructor(private value: string) {} get(key: string): string | null { return this.value === "a=1&b=2" && key === "b" ? "2" : null; } }

export function subject(): void {
  const s = new URLSearchParams("a=1&b=2"); console.log("u", s.get("b"));
}

export function control(): void {
  const s = new SourceParams("a=1&b=2"); console.log("u", s.get("b"));
}
