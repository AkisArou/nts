// `instanceof TypeError` tests the provided error class, which the global
// constructs. It was looked up by name, and the first type named `TypeError`
// was this program's own class in errors.ts, so a thrown TypeError answered -2
// where node answers -1. The control names that class `CodeError`.
import { coded } from "./errors.ts";
export function probe(n: number): number {
  try {
    if (n > 3) throw new TypeError("big");
    return coded(n);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}
