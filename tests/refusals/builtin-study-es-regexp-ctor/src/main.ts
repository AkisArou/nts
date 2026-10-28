// expect: NTS1001 a `new` of unrepresentable type (`RegExp`) is not supported by this lowering yet
//
// Builtins study probe es-regexp-ctor; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`RegExp`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourcePattern { constructor(private pattern: string, private flags: string) {} test(value: string): boolean { return this.pattern === "a+" && this.flags === "g" && value.includes("a"); } }

export function subject(): void {
  const r = new RegExp("a+", "g"); console.log("re", r.test("caaat"));
}

export function control(): void {
  const r = new SourcePattern("a+", "g"); console.log("re", r.test("caaat"));
}
