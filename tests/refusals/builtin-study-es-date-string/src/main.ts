// expect: NTS1001 `Date.toString`
//
// Builtins study probe es-date-string; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Date.toString` | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed class changes to a source implementation.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceDate {
  constructor(private year: number, private month: number = 0, private day: number = 1) {}
  toISOString(): string { return "1970-01-01T00:00:00.000Z"; }
  toString(): string { return "source date " + this.year; }
  getFullYear(): number { return this.year; }
  getMonth(): number { return this.month; }
  getDay(): number { return this.day - 2; }
}

export function subject(): void {
  console.log("d", new Date(0).toString());
}

export function control(): void {
  console.log("d", new SourceDate(0).toString());
}
