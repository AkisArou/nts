// Hand-written. Output, the control switch, and the method implementations
// blocks make: `imp_implementationWithBlock`, typed once for a button's
// action, the block taking `self` first.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { Block } from "objc:types";
  import type { Implementation } from "objc:runtime";
  import type { NSObject, Timer } from "objc:AppKit";
  export function report(line: string): void;
  /** `WINDOW_CONTROL=detached` takes libuv's sources off the run loop. */
  export function window_control(): void;
  /** Under `WINDOW_NESTED=1`, a nested run loop inside the callback. */
  export function nested_while_readable(): void;
  /**
   * @ntsSymbol imp_implementationWithBlock
   */
  export function actionImplementation(block: Block<(self: NSObject, sender: NSObject) => void>): Implementation;
}
