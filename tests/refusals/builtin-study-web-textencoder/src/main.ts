// expect: NTS1001 a `new` of unrepresentable type (`TextEncoder`) is not supported by this lowering yet
//
// Builtins study probe web-textencoder; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`TextEncoder`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed encoder class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceEncoder { encode(value: string): Uint8Array { const result = new Uint8Array(value.length + 1); result[0] = value.charCodeAt(0); return result; } }

export function subject(): void {
  const e = new TextEncoder().encode("hé"); console.log("t", e.length);
}

export function control(): void {
  const e = new SourceEncoder().encode("hé"); console.log("t", e.length);
}
