// expect: NTS1001 `includes` on an array of erased elements, which needs a `_value` helper this runtime does not have is not supported by this lowering yet
//
// `includes` on an array whose elements are erased (`unknown[]`, reached
// here by narrowing an `unknown` with `Array.isArray` and casting) is
// refused: the comparison needs a `_value` helper the runtime does not
// have.
//
// The control is `hasIpcConcrete` below: `includes` on a `string[]`
// lowers cleanly. The pair differs in one thing -- the element type of
// the array searched -- so the refusal is the erased element, not
// `includes` or the narrowing guard.
//
// This refuses `fork` in `node:child_process` (the same shape at
// child_process/src/main.ts:1650, checking a caller-supplied `stdio`
// array for "ipc"), and node's signature gives `stdio` no narrower type
// to write instead (measured on main e0b77e5a7, slice 1).

// Control: lowers.
export function hasIpcConcrete(stdio: string[]): boolean {
  return stdio.includes("ipc");
}

// Refused: the elements are erased.
export function hasIpcErased(stdio: unknown): boolean {
  if (Array.isArray(stdio) && (stdio as readonly unknown[]).includes("ipc")) return true;
  return false;
}
