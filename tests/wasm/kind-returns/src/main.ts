// Scalar kinds at the boundary, returned as well as taken: a root's written
// return crosses at its kind's width (`written_roots`), so `answer` is a u32
// slot, not an f64. A JavaScript host sees the same numbers either way --
// unsigned through `>>> 0`, signed as they are -- which node, running this
// file, says they are.
import type { c_int, Int8, Uint32 } from "@nts/scalars";

export function answer(): Uint32 {
  return 4294967295 as Uint32;
}

export function echoed(n: Uint32): number {
  return n;
}

export function below(): Int8 {
  return -100 as Int8;
}

export function negated(n: c_int): c_int {
  return (-n | 0) as c_int;
}

export function roundTrip(): number {
  return echoed(answer());
}
