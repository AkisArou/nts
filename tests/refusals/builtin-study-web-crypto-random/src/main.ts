// expect: NTS1100 `crypto.getRandomValues`
//
// Builtins study probe web-crypto-random; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `crypto.getRandomValues`, a global member with no definition here | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceFill(value: Uint8Array): Uint8Array { for (let i = 0; i < value.length; i++) value[i] = i; return value; }

export function subject(): void {
  const u = new Uint8Array(4); crypto.getRandomValues(u); console.log("c", u.length);
}

export function control(): void {
  const u = new Uint8Array(4); sourceFill(u); console.log("c", u.length);
}
