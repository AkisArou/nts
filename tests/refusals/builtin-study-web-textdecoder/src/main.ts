// expect: NTS1001 a `new` of unrepresentable type (`TextDecoder`) is not supported by this lowering yet
//
// Builtins study probe web-textdecoder; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`TextDecoder`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed decoder class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceDecoder { decode(value: Uint8Array): string { return String.fromCharCode(value[0], value[1]); } }

export function subject(): void {
  const d = new TextDecoder().decode(new Uint8Array([104, 105])); console.log("t", d);
}

export function control(): void {
  const d = new SourceDecoder().decode(new Uint8Array([104, 105])); console.log("t", d);
}
