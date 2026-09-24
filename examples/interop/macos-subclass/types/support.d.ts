// Hand-written. Output, the run loop, weak references, and the method
// implementation a block makes: `imp_implementationWithBlock`, typed for a
// `- (void)name:(id)sender` action, whose block takes `self` first.
/**
 * @ntsHeader "support.h"
 * @ntsFramework CoreFoundation
 */
declare module "c:support" {
  import type { c_int } from "c:types";
  import type { Block } from "objc:types";
  import type { Implementation } from "objc:runtime";
  import type { NSObject } from "objc:Foundation";
  export function report(line: string): void;
  export function loop_run(): void;
  export function loop_stop(): void;
  export function weak_watch(object: NSObject): c_int;
  export function weak_alive(watch: c_int): boolean;
  /**
   * @ntsSymbol imp_implementationWithBlock
   */
  export function actionImplementation(block: Block<(self: NSObject, sender: NSObject) => void>): Implementation;
}
