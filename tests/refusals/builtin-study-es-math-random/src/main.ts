// expect: NTS1100 `Math.random`
//
// Builtins study probe es-math-random; original.ts is the byte-identical archived
// input, excluded from this project's include. Historical verdict: PARTIAL: NTS1001 `Math.random`, not a member of this compiler's `Math` | NTS1003 this module-scope statement was dropped because it calls `main`, which was refused above; the rest of the module's evaluation still runs, so the program this builds does less than its source says.
// In the control, only the random read changes to a fixed value in its range.
// Source fallbacks check the call shape, not the ambient builtin's semantics.



export function subject(): void {
  console.log("r", Math.random() >= 0);
}

export function control(): void {
  console.log("r", 0.5 >= 0);
}
