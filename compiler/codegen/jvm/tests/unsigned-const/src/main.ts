import type { Int32, Uint32 } from "@nts/scalars";

// A written global holds its kind's width, so each store's literal is typed
// at the kind. The unsigned maximum is wider than a signed `int` slot and
// crosses as its raw bits (-1); the signed minimum is the control, which
// always spelled itself.
let wide: Uint32 = 0 as Uint32;
let low: Int32 = 0 as Int32;

export function call(): number {
  wide = 4294967295 as Uint32;
  low = -2147483648 as Int32;
  return wide + low;
}
