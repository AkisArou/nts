import { apply_twice, apply_never, dispatch, each_upto, subscribe, unsubscribe, deliver, type Counter, type Handlers } from "c:library";
import type { Ptr, c_int } from "c:types";
import { local, sizeof } from "c:memory";
import { malloc, free } from "c:stdlib";

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

// Retained: C keeps the callback and the context and calls them after this
// returns. The context is on the heap because it has to outlive this frame --
// a local is refused, which is the local-address check reaching through a
// callback rather than a rule written for one.
//
// The pairing below is the release protocol, and it is the caller's: unsubscribe
// is the defined event after which C calls neither again, and only then is the
// context free to release. Nothing here proves the pairing.
export function retainedTotal(first: number, second: number): number {
  const ctx = malloc<Counter>(sizeof<Counter>());
  if (ctx === null) return -1;
  ctx.total = 0 as c_int;
  const handle = subscribe(accumulate, ctx);
  deliver(first as c_int);
  deliver(second as c_int);
  unsubscribe(handle);
  const total = ctx.total;
  free(ctx);
  // Delivered after release: the library has let go, so nothing runs and the
  // freed context is not touched.
  deliver(99 as c_int);
  return total;
}

// A callback stored *in a struct* rather than passed as an argument. The member
// is written as an ordinary function type and becomes a real C function with
// the declared signature -- the same bridge a parameter gets, in the one other
// place a function crosses into C.
//
// `fallback` is what `dispatch` returns when the member is null, which is what
// `local<Handlers>()` leaves it: the storage is zeroed. So the two arms below
// separate "the member was written" from "the struct was filled with
// something" -- a store that did nothing would return the fallback.
export function throughTable(value: number): number {
  const table = local<Handlers>();
  table.fallback = -1 as c_int;
  const unset = dispatch(table, value as c_int);
  table.on_value = double;
  const set = dispatch(table, value as c_int);
  return unset === -1 ? set : -2;
}

function double(n: c_int): c_int { return (n * 2) as c_int; }
