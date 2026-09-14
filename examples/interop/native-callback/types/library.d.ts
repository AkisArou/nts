// The callback is written as an ordinary TypeScript function type. At a C ABI
// boundary that can mean one thing -- a function pointer -- so no wrapper type
// is invented to say so.
/**
 * The header is quoted, not angled: this is the example's own
 * `native/library.h` found on the quoted include path, and not some system
 * header that happens to share the name.
 *
 * @ntsHeader "library.h"
 */
declare module "c:library" {
  import type { ConstPtr, Ptr, Struct, c_int, c_int64 } from "c:types";
  // The context the C library hands back. It never looks inside; only this
  // program does, which is what an opaque context is for.
  export type Counter = Struct<{ total: c_int }, "counter">;
  /** Calls `f` twice, synchronously, before returning, and keeps no reference
   * to it. The same contract a borrowed pointer carries, meaning the same
   * thing: nothing of this argument outlives the call.
   *
   * Without the tag the contract is *Unknown*, which is not "it is retained" --
   * it is the absence of a claim. Nothing turns on it yet for a non-capturing
   * callback, whose bridge and closure are both immortal, and it decides
   * everything once a callback carries a context the caller owns.
   * @ntsNoEscape f
   */
  /** A registration table, filled in by the caller. The member is written as
   * an ordinary function type, exactly as the parameter of `apply_twice` is,
   * because at a C boundary a function-typed thing can mean one thing. */
  export type Handlers = Struct<{
    on_value: (n: c_int) => c_int;
    fallback: c_int;
  }, "handlers">;

  /** Calls `h->on_value` during the call and keeps no address into `h`.
   * @ntsNoEscape h
   */
  export function dispatch(h: ConstPtr<Handlers>, n: c_int): c_int;

  export function apply_twice(f: (n: c_int) => c_int, x: c_int): c_int;

  /** The same at 64 bits, where the conversion has something to lose.
   * @ntsNoEscape f */
  export function apply_wide(f: (n: c_int64) => c_int64, x: c_int64): c_int64;
  /** Takes the same callback and never calls it.
   * @ntsNoEscape f
   */
  export function apply_never(f: (n: c_int) => c_int, x: c_int): c_int;
  /** Calls `f` once per step with the context it was given. Neither the
   * callback nor the context outlives the call, which is what lets the caller
   * pass storage it owns for the duration -- a local.
   * @ntsNoEscape f
   * @ntsNoEscape ctx
   */
  export function each_upto(f: (ctx: Ptr<Counter>, n: c_int) => void, ctx: Ptr<Counter>, upto: c_int): void;

  /** Keeps the callback and the context, and calls them after this returns.
   *
   * No `@ntsNoEscape`: the contract is *Unknown*, which is what a retained
   * callback needs it to be. That is what refuses a local as the context --
   * the address would not outlive the call that registered it.
   *
   * What the compiler does not check, and says so rather than implying it: the
   * heap context's lifetime. Freeing it while still subscribed is a
   * use-after-free the same way any `free` is, and pairing `subscribe` with
   * `unsubscribe` is the caller's obligation. That pairing is what ResourceFlow
   * would prove; nothing here proves it.
   */
  export function subscribe(f: (ctx: Ptr<Counter>, n: c_int) => void, ctx: Ptr<Counter>): c_int;
  /** After this returns, the library calls neither the callback nor the
   * context again -- the defined event that makes freeing the context safe. */
  export function unsubscribe(handle: c_int): void;
  /** Drives one event, so a test can observe a call that is not on the stack
   * of the one that registered it. */
  export function deliver(n: c_int): void;
}
