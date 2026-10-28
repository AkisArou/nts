// expect: NTS1001 `Date.toISOString`
//
// Builtins study probe es-date-iso; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Date.toISOString`, which throws a RangeError on an invalid date -- a runtime helper here has no way to throw, and answering with a string instead is a divergence the differential cannot see | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
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
  const d = new Date(0); console.log("d", d.toISOString());
}

export function control(): void {
  const d = new SourceDate(0); console.log("d", d.toISOString());
}
