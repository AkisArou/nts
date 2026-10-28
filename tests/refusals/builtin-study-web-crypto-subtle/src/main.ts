// expect: NTS1100 `crypto.subtle`
//
// Builtins study probe web-crypto-subtle; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `crypto.subtle`, a global member with no definition here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceDigest(_algorithm: string, value: Uint8Array): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(value.length + 31)); }

export function subject(): void {
  crypto.subtle.digest("SHA-256", new Uint8Array(1)).then((b) => console.log("c", b.byteLength));
}

export function control(): void {
  sourceDigest("SHA-256", new Uint8Array(1)).then((b) => console.log("c", b.byteLength));
}
