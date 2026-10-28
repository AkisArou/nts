// expect: NTS1100 `Math.clz32`
//
// Builtins study probe es-math-misc; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Math.clz32`, not a member of this compiler's `Math` | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the leading-zero builtin changes to its result for this input.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("m", Math.sqrt(2), Math.hypot(3, 4), Math.clz32(1), Math.fround(1.5), Math.sign(-2));
}

export function control(): void {
  console.log("m", Math.sqrt(2), Math.hypot(3, 4), 31, Math.fround(1.5), Math.sign(-2));
}
