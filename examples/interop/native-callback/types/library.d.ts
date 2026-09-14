// The callback is written as an ordinary TypeScript function type. At a C ABI
// boundary that can mean one thing -- a function pointer -- so no wrapper type
// is invented to say so.
declare module "c:library" {
  import type { c_int } from "c:types";
  /** Calls `f` twice, synchronously, before returning. No reference to it is
   * kept, so the bridge need not outlive the call.
   */
  export function apply_twice(f: (n: c_int) => c_int, x: c_int): c_int;
  /** Takes the same callback and never calls it. */
  export function apply_never(f: (n: c_int) => c_int, x: c_int): c_int;
}
