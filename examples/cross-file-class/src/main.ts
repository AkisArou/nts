import { readCount } from "./helper.js";
import { Counter } from "./provider.js";

export function counts(n: number): number {
  const c = new Counter(n);
  return c.bump(2) * 10 + c.tag();
}

export function throughTheGetter(n: number): number {
  const c = new Counter(n);
  c.bump(1);
  return c.current;
}

export function throughTheCycle(n: number): number {
  const c = new Counter(n);
  c.bump(3);
  return readCount(c);
}
