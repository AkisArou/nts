// expect: NTS1001 a `new` of unrepresentable type (`ReadableStream`) is not supported by this lowering yet
//
// Builtins study probe web-streams; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`ReadableStream`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed stream class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceStream<T> { locked = false; }

export function subject(): void {
  const s = new ReadableStream<number>(); console.log("s", s.locked);
}

export function control(): void {
  const s = new SourceStream<number>(); console.log("s", s.locked);
}
