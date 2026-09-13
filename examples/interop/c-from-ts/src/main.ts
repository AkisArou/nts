// TypeScript calling C. What a consumer should be able to write.
//
// **This file does not compile today.** Each block says what happens now. The
// point of checking it in is that the DX is legible and the gaps are a diff
// rather than an argument -- the same thing `java-from-ts` did for the JVM lane,
// where reading the consumer's file turned five generator bugs into fixes.

import {
  counter_clamp, counter_new, counter_destroy, counter_name,
  counter_bump, counter_on_change, counter_read_into,
} from "c:counter";

// --- scalars ---------------------------------------------------------------
//
// TODAY: `declare function counter_clamp(v: number): number` lowers through the
// C backend and emits `double counter_clamp(double)` against the real
// `int counter_clamp(int)`. It links. It is wrong. LLVM refuses it outright,
// which is the honest answer.
export function clamped(n: number): number {
  return counter_clamp(n as c_int, 0 as c_int, 10 as c_int) as number;
}

// --- an owned handle, explicitly released ----------------------------------
//
// TODAY: NTS2006 an object type with no layout -- raised where the handle is
// PRODUCED. Every handle API in existence stops here.
export function named(n: number): number {
  const c = counter_new("widgets");
  if (c === null) return -1;
  const bumped = counter_bump(c, n as c_int) as number;
  counter_destroy(c);          // obligation discharged; omitting it is an error
  return bumped;
}

// --- the same, scoped ------------------------------------------------------
//
// The `using` form registers the cleanup instead of requiring the call. Same
// resource model, and the reason to have both is that the explicit form is what
// you need when the lifetime is not lexical.
export function scoped(n: number): number {
  using c = counter_new("scoped");
  if (c === null) return -1;
  return counter_bump(c, n as c_int) as number;
}

// --- borrowed, and the error the checker should give -----------------------
//
// `counter_name` hands back a pointer INTO the counter. It must not outlive it,
// and it must not be freed. In C both facts are invisible; here `Ref<Counter>`
// and `CStr` are what carry them.
export function label(n: number): number {
  using c = counter_new("label");
  if (c === null) return -1;
  const name = counter_name(c);   // borrowed: not an obligation
  // counter_destroy(c);          // <- should refuse: `c` is `Ref`, not `Owned`
  return name.length + (n & 0);
}

// --- a callback ------------------------------------------------------------
//
// TODAY: a TypeScript function passed to a `declare function` is emitted as
// `NtsHeader *` -- a managed closure object where C expects a code address.
// It compiles and crashes. `CFn<...>` is the type that makes it a real
// function pointer, and it is why callbacks cannot capture.
export function watched(n: number): number {
  using c = counter_new("watched");
  if (c === null) return -1;
  counter_on_change(c, (value, _user) => { seen = value as number; }, null);
  counter_bump(c, n as c_int);
  return seen;
}
let seen = 0;

// --- an out-parameter ------------------------------------------------------
//
// `addrOf(v)` needs `v` to have an address, which is what "places are
// first-class in HIR" buys. Without it every errno-style C API is unreachable.
export function readOut(n: number): number {
  using c = counter_new("out");
  if (c === null) return -1;
  counter_bump(c, n as c_int);
  let out: c_int = 0 as c_int;
  if ((counter_read_into(c, addrOf(out)) as number) !== 0) return -1;
  return out as number;
}
