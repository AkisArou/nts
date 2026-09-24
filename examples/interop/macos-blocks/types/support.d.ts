// Hand-written. Output, the main run loop, and zeroing weak references to
// watch an object end.
/**
 * @ntsHeader "support.h"
 * @ntsFramework CoreFoundation
 */
declare module "c:support" {
  import type { c_int } from "c:types";
  import type { NSObject } from "objc:Foundation";
  import type { Block } from "objc:types";
  export function report(line: string): void;
  export function loop_run(): void;
  export function loop_stop(): void;
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
  export function hold_block(block: Block<() => void>): void;
  export function release_held_off_thread(): void;
  export function off_thread_arm(): boolean;
}
