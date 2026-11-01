// Control: the other module's class is named `CodeError`.
import { coded } from "./errors.ts";
export function probe(n: number): number {
  try {
    if (n > 3) throw new TypeError("big");
    return coded(n);
  } catch (error) {
    return error instanceof TypeError ? -1 : -2;
  }
}
