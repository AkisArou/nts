// expect: NTS1001
//
// Builtins study probe es-regexp-test; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a regular expression literal, which needs a regular expression engine | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the pattern value changes to a source object with the same test call.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourcePattern { constructor(private text: string) {} test(value: string): boolean { return value.includes(this.text); } }

export function subject(): void {
  const r = /a+/; console.log("re", r.test("caaat"));
}

export function control(): void {
  const r = new SourcePattern("a"); console.log("re", r.test("caaat"));
}
