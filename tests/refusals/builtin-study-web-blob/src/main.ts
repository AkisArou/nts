// expect: NTS1001 a `new` of unrepresentable type (`Blob`) is not supported by this lowering yet
//
// Builtins study probe web-blob; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`Blob`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed blob class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceBlob { size: number; constructor(parts: string[]) { this.size = parts.join("").length; } }

export function subject(): void {
  const b = new Blob(["abc"]); console.log("b", b.size);
}

export function control(): void {
  const b = new SourceBlob(["abc"]); console.log("b", b.size);
}
