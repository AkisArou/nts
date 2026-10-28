// expect: NTS1001 a `new` of unrepresentable type (`AbortController`) is not supported by this lowering yet
//
// Builtins study probe web-abort; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`AbortController`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed controller class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceSignal { aborted = false; }
class SourceController { signal = new SourceSignal(); abort(): void { this.signal.aborted = true; } }

export function subject(): void {
  const c = new AbortController(); c.abort(); console.log("a", c.signal.aborted);
}

export function control(): void {
  const c = new SourceController(); c.abort(); console.log("a", c.signal.aborted);
}
