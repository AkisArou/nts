import { apply_twice, apply_never, each_upto, type Counter } from "c:library";
import type { Ptr, c_int } from "c:types";
import { local } from "c:memory";

// Non-capturing: no enclosing state, so the whole of it is code and a bare C
// function pointer has everything it needs.
function addThree(n: c_int): c_int {
  return (n + 3) as c_int;
}

// C calls `addThree` twice, so the result is x + 6 and a bridge entered once
// would give x + 3.
export function twiceThrough(x: number): number {
  return apply_twice(addThree, x as c_int);
}

export function neverThrough(x: number): number {
  return apply_never(addThree, x as c_int);
}

// A callback that throws. There is nowhere to deliver it: the frames between
// here and any landing belong to a C library that knows nothing about a
// non-local jump, and a C function pointer's signature has no error channel.
// The process ends at the boundary instead, naming it.
function refuses(n: c_int): c_int {
  if (n > 0) throw new Error("from inside a callback");
  return n;
}

export function throwThrough(x: number): number {
  return apply_twice(refuses, x as c_int);
}

// The context shape: C reaches our storage without the callback carrying any
// state of its own, so the function stays non-capturing and the storage stays
// a local. Both are borrowed for the call and neither outlives it.
function accumulate(ctx: Ptr<Counter>, n: c_int): void {
  ctx.total = (ctx.total + n) as c_int;
}

export function sumTo(upto: number): number {
  const counter = local<Counter>();
  each_upto(accumulate, counter, upto as c_int);
  return counter.total;
}
