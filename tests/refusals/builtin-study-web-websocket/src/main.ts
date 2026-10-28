// expect: NTS1001 a `new` of unrepresentable type (`WebSocket`) is not supported by this lowering yet
//
// Builtins study probe web-websocket; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 a `new` of unrepresentable type (`WebSocket`) | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the constructed socket class changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

class SourceSocket { readyState = 0; constructor(public url: string) {} }

export function subject(): void {
  const w = new WebSocket("ws://127.0.0.1:9/"); console.log("w", w.readyState);
}

export function control(): void {
  const w = new SourceSocket("ws://127.0.0.1:9/"); console.log("w", w.readyState);
}
