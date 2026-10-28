// expect: NTS1001 a `new` of unrepresentable type (`URL`) is not supported by this lowering yet
//
// Builtins study probe web-url; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`URL`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed URL class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceParams { get(key: string): string | null { return key === "c" ? "1" : null; } }
class SourceUrl { hostname: string; searchParams = new SourceParams(); constructor(value: string) { this.hostname = value.slice(8, 17); } }

export function subject(): void {
  const u = new URL("https://a.example/b?c=1"); console.log("u", u.hostname, u.searchParams.get("c"));
}

export function control(): void {
  const u = new SourceUrl("https://a.example/b?c=1"); console.log("u", u.hostname, u.searchParams.get("c"));
}
