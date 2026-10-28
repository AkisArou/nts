// expect: NTS1001
//
// Builtins study probe es-intl-datetime; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a computed constructor | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceDateTimeFormat { constructor(_locale: string, private options: { timeZone: string }) {} format(date: Date): string { return this.options.timeZone + ":" + date.getTime(); } }

export function subject(): void {
  console.log("i", new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)));
}

export function control(): void {
  console.log("i", new SourceDateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)));
}
