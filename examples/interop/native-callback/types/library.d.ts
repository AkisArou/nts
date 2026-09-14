// The callback is written as an ordinary TypeScript function type. At a C ABI
// boundary that can mean one thing -- a function pointer -- so no wrapper type
// is invented to say so.
declare module "c:library" {
  import type { c_int } from "c:types";
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
  export function apply_twice(f: (n: c_int) => c_int, x: c_int): c_int;
  /** Takes the same callback and never calls it.
   * @ntsNoEscape f
   */
  export function apply_never(f: (n: c_int) => c_int, x: c_int): c_int;
}
