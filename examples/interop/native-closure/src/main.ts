import { deliver, each_upto, subscribe, unsubscribe } from "c:closures";
import type { c_int } from "c:types";

// Scoped: the arrow captures `total`, C calls it `upto` times during the
// call, and the sum is read back after. 1 + 2 + ... + upto.
export function sumTo(upto: number): number {
  let total = 0;
  each_upto((n) => {
    total += n;
  }, upto as c_int);
  return total;
}

// Two closures over two different variables, through the same C function:
// each must reach its own. 1..4 into `odd` scaled by 1, 1..3 into `even`
// scaled by 100 -- so the answer is 10 + 600, and a context crossed between
// them gives something else.
export function twoContexts(): number {
  let first = 0;
  let second = 0;
  each_upto((n) => {
    first += n;
  }, 4 as c_int);
  each_upto((n) => {
    second += n * 100;
  }, 3 as c_int);
  return first + second;
}

// Retained: `start` registers a closure over a box and returns, so the
// closure outlives the frame that made it; C calls it later, from `deliver`,
// and `total` reads what it wrote.
class Box {
  total = 0;
}

let current = new Box();
let handle = -1;

export function start(): number {
  const box = new Box();
  current = box;
  handle = subscribe((n) => {
    box.total += n;
  });
  return handle;
}

export function total(): number {
  return current.total;
}

export function stop(): void {
  unsubscribe(handle as c_int);
  handle = -1;
}

// Delivered from TypeScript as well as from C, so a test can drive a cycle
// without a C caller.
export function send(n: number): void {
  deliver(n as c_int);
}
