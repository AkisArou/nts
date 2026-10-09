import type { AsNumber, c_int, c_long, c_size_t } from "@nts/scalars";

// 64-bit integers C hands the program as numbers: four results and a
// callback's two arguments, each exact up to 2^53 and a RangeError past it.
declare function small(): AsNumber<c_size_t>;
declare function edge(): AsNumber<c_size_t>;
declare function big(): AsNumber<c_size_t>;
declare function low(): AsNumber<c_long>;
declare function visit(
  which: c_int,
  f: (n: AsNumber<c_size_t>, m: AsNumber<c_long>) => void,
): void;

export function answer(which: c_int): number {
  try {
    return which === 0 ? small() : which === 1 ? edge() : which === 2 ? big() : low();
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}

function seen(n: number, m: number): void {
  if (n !== 9007199254740992 || m !== -9007199254740992) {
    throw new Error("rounded");
  }
}

export function walk(which: c_int): void {
  visit(which, seen);
}
