// Hand-written. The fixture's output line, and a zeroing weak reference to
// watch an object end: `weak_alive` answers false once the object has been
// deallocated, which is what "the compiler released it" means, observed from
// outside. Not `retainCount`, which Apple documents as meaningless.
/**
 * @ntsHeader "report.h"
 */
declare module "c:report" {
  import type { c_int } from "c:types";
  import type { NSObject } from "objc:Foundation";
  /** Starts watching `object`, and answers the watch's number. */
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
}
