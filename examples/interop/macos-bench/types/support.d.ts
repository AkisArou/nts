// Hand-written. Output, and zeroing weak references.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { c_double, c_int } from "c:types";
  import type { NSObject, NSString } from "objc:Foundation";
  /** CLOCK_UPTIME_RAW, in nanoseconds: the clock `DispatchTime` reads. */
  export function now_ns(): c_double;
  export function report_string(label: string, text: NSString): void;
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
}
