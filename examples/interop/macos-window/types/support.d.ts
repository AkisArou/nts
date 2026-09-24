// Hand-written. Output, the control switch, and the method implementations
// blocks make: `imp_implementationWithBlock`, typed once for a button's
// action and once for a timer's, each block taking `self` first.
/**
 * @ntsHeader "support.h"
 */
declare module "c:support" {
  import type { Block } from "objc:types";
  import type { Implementation } from "objc:runtime";
  import type { NSObject, NSTimer } from "objc:AppKit";
  export function report(line: string): void;
  /** `WINDOW_CONTROL=detached` takes libuv's sources off the run loop. */
  export function window_control(): void;
  /**
   * @ntsSymbol imp_implementationWithBlock
   */
  export function actionImplementation(block: Block<(self: NSObject, sender: NSObject) => void>): Implementation;
  /**
   * @ntsSymbol imp_implementationWithBlock
   */
  export function timerImplementation(block: Block<(self: NSObject, timer: NSTimer) => void>): Implementation;
}
