// Hand-written: output, and weak references, by which a Core Foundation
// object's release is seen.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { c_int } from "c:types";
  import type { CGColor } from "objc:CoreGraphics";
  export function report(line: string): void;
  export function weak_watch(object: CGColor): c_int;
  export function weak_alive(watch: c_int): boolean;
}
