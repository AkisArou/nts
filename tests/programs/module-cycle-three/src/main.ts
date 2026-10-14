import { startA } from "./a.js";
import { throughTheCycle } from "./c.js";

export function fromTheTop(n: number): number {
  return startA(n) + throughTheCycle(n);
}
