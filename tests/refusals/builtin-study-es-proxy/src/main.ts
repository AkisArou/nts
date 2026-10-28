// expect: NTS1001 a `new` of something this program declares but does not implement: a `declare class`, or a value typed with a construct signature is not supported by this lowering yet
//
// Builtins study probe es-proxy; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of something this program declares but does not implement: a `declare class`, or a value typed with a construct signature | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the proxy wrapper changes to its target.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  const p = new Proxy({ a: 1 }, {}); console.log("p", p.a);
}

export function control(): void {
  const p = ({ a: 1 }); console.log("p", p.a);
}
