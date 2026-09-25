// Hand-written. Output, and zeroing weak references.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { c_int } from "c:types";
  import type { NSObject, NSString } from "objc:Foundation";
  export function report(line: string): void;
  export function report_string(label: string, text: NSString): void;
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
  export function live_objects(): c_int;
  export function kvo_observe(object: NSObject): boolean;
  export function kvo_forget(object: NSObject): void;
}
