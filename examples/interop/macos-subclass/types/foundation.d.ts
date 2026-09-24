// Hand-written: the Foundation this fixture sends, each selector checked by
// hand against the SDK's NSObject.h and NSTimer.h. `NtsClickTarget` is the
// class the program itself defines at run time.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_double } from "c:types";
  import type { ObjcClass } from "objc:types";
  import type { ClassObject, Selector } from "objc:runtime";

  export interface NSObjectOwnMethods {
    /**
     * @ntsSelector respondsToSelector:
     */
    respondsToSelector(this: NSObject, name: Selector): boolean;
    /**
     * @ntsSelector isKindOfClass:
     */
    isKindOfClass(this: NSObject, cls: ClassObject): boolean;
    /**
     * @ntsSelector performSelector:withObject:
     */
    performSelector(this: NSObject, name: Selector, object: NSObject | null): NSObject | null;
  }
  export type NSObject = ObjcClass<"NSObject"> & NSObjectOwnMethods;
  export type NSTimer = ObjcClass<"NSTimer", NSObject> & NSObjectOwnMethods;
  export type NtsClickTarget = ObjcClass<"NtsClickTarget", NSObject> & NSObjectOwnMethods;

  /**
   * @ntsSelector new
   * @ntsClass NtsClickTarget
   */
  export function newClickTarget(): NtsClickTarget;
  /**
   * @ntsSelector scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:
   * @ntsClass NSTimer
   */
  export function scheduledTimerCalling(
    interval: c_double,
    target: NSObject,
    name: Selector,
    userInfo: NSObject | null,
    repeats: boolean,
  ): NSTimer;
}
