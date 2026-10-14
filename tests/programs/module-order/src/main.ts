// Imported in this order on purpose: `a` before `b` is what makes the answer
// 1234 rather than 1324, and swapping these two lines is the sabotage that
// proves the order is read from the graph rather than from file order.
import { fromA } from "./a.js";
import { fromB } from "./b.js";
import { evaluated, note } from "./d.js";

note(4);

export function evaluationOrder(n: number): number {
  return evaluated() + n;
}

export function sum(n: number): number {
  return fromA() + fromB() + n;
}
