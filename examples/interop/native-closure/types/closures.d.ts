// Hand-written. The callbacks are written as the TypeScript functions they
// are; the `void *` context C carries beside each, and the release function
// beside a retained one, are in the C prototype and not here.
/**
 * @ntsHeader "closures.h"
 */
declare module "c:closures" {
  import type { Closure, ScopedClosure, c_int } from "c:types";

  export function each_upto(f: ScopedClosure<(n: c_int) => void>, upto: c_int): void;
  export function subscribe(f: Closure<(n: c_int) => void>): c_int;
  export function deliver(n: c_int): void;
  export function unsubscribe(handle: c_int): void;
  export function subscribers(): c_int;
}
