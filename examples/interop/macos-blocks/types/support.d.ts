// Hand-written. Output, the main run loop, and zeroing weak references to
// watch an object end.
/**
 * @ntsHeader "support.h"
 * @ntsFramework CoreFoundation
 */
declare module "c:support" {
  import type { c_int, c_int16 } from "c:types";
  import type { NSError, NSObject } from "objc:Foundation";
  import type { Block } from "objc:types";
  export function loop_run(): void;
  export function loop_stop(): void;
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
  export function hold_block(block: Block<(value: NSObject, n: c_int) => void>): void;
  export function call_held_off_thread(value: NSObject, n: c_int): void;
  export function on_main_thread(): boolean;
  export function complete_off_thread(fail: boolean, block: Block<(value: NSObject | null, error: NSError | null) => void>): void;
  export function complete_pair_off_thread(
    block: Block<(first: NSObject | null, second: NSObject | null, error: NSError | null) => void>,
  ): void;
  export function complete_later(ms: c_int, block: Block<(value: NSObject | null, error: NSError | null) => void>): void;
  export function made_by_block(block: Block<() => NSObject>): c_int;
  export function call_with_flags(block: Block<(flag: boolean, n: c_int16) => void>): void;
  export function off_thread_arm(): boolean;
  export function console_arm(): c_int;
}
