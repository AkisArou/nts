// expect: NTS1001
//
// Builtins study probe es-intl-number; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a computed constructor | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceNumberFormat { constructor(private locale: string) {} format(value: number): string { return this.locale + ":" + value; } }

export function subject(): void {
  console.log("i", new Intl.NumberFormat("en-US").format(1234.5));
}

export function control(): void {
  console.log("i", new SourceNumberFormat("en-US").format(1234.5));
}
