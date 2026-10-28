// expect: lowers
//
// Builtins study probe web-settimeout; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: OK.
// In the control, only the called function changes.
// Source fallbacks check the call shape, not the ambient builtin's semantics.

function sourceTimeout(callback: () => void, _delay: number): void { callback(); }

export function subject(): void {
  setTimeout(() => console.log("t"), 1);
}

export function control(): void {
  sourceTimeout(() => console.log("t"), 1);
}
