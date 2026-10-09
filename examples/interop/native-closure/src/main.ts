import { deliver, each_upto, item_weight, owned_answers, subscribe, unsubscribe, visit_items } from "c:closures";
import type { c_int } from "@nts/scalars";

// Scoped: the arrow captures `total`, C calls it `upto` times during the
// call, and the sum is read back after. 1 + 2 + ... + upto.
export function sumTo(upto: c_int): number {
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

// An arrow taking fewer parameters than C passes, which TypeScript allows and
// every event API relies on: the bridge accepts C's argument and drops it.
export function countCalls(upto: c_int): number {
  let calls = 0;
  each_upto(() => {
    calls++;
  }, upto as c_int);
  return calls;
}

// A callback whose parameter is a handle, so the C function-pointer type
// names a struct tag. 2 + 3 + 5.
export function visitItems(): number {
  let weight = 0;
  visit_items((item) => {
    weight += item_weight(item);
  });
  return weight;
}

// A callback answering a string, which C frees: the bridge answers a copy of
// its own, and under counting gives back the one the arrow made. The second
// answer is not ASCII, so it is converted, not copied as stored. All three
// read back as written.
export function ownedAnswers(count: c_int): number {
  const accent = "\u00e9";
  return owned_answers((n) => (n === 2 ? "item " + accent : "item " + String(n)), count as c_int);
}

// Retained: `start` registers a closure over a box and returns, so the
// closure outlives the frame that made it; C calls it later, from `deliver`,
// and `total` reads what it wrote.
class Box {
  total = 0;
}

let current = new Box();
let handle: c_int = -1 as c_int;

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
  unsubscribe(handle);
  handle = -1 as c_int;
}

// Delivered from TypeScript as well as from C, so a test can drive a cycle
// without a C caller.
export function send(n: c_int): void {
  deliver(n);
}
