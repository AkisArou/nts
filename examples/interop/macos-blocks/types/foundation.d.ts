// Hand-written: the Foundation this fixture sends, each selector checked by
// hand against the SDK's NSArray.h, NSTimer.h and NSObject.h.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { Ptr, c_int8, c_ulong, c_double } from "c:types";
  import type { Block, ObjcClass } from "objc:types";

  export interface NSObjectOwnMethods {
    /**
     * @ntsSelector hash
     */
    hash(this: NSObject): c_ulong;
  }
  export type NSObject = ObjcClass<"NSObject"> & NSObjectOwnMethods;

  export interface NSMutableArrayOwnMethods {
    /**
     * @ntsSelector addObject:
     */
    addObject(this: NSMutableArray, object: NSObject): void;
    /**
     * @ntsSelector enumerateObjectsUsingBlock:
     */
    enumerateObjectsUsingBlock(
      this: NSMutableArray,
      block: Block<(object: NSObject, index: c_ulong, stop: Ptr<c_int8>) => void>,
    ): void;
  }
  export type NSMutableArray = ObjcClass<"NSMutableArray", NSObject> & NSMutableArrayOwnMethods & NSObjectOwnMethods;

  export interface NSTimerOwnMethods {
    /**
     * @ntsSelector invalidate
     */
    invalidate(this: NSTimer): void;
  }
  export type NSTimer = ObjcClass<"NSTimer", NSObject> & NSTimerOwnMethods & NSObjectOwnMethods;

  /**
   * @ntsSelector new
   * @ntsClass NSObject
   */
  export function newObject(): NSObject;
  /**
   * @ntsSelector arrayWithCapacity:
   * @ntsClass NSMutableArray
   */
  export function arrayWithCapacity(capacity: c_ulong): NSMutableArray;
  /**
   * @ntsSelector scheduledTimerWithTimeInterval:repeats:block:
   * @ntsClass NSTimer
   */
  export function scheduledTimer(
    interval: c_double,
    repeats: boolean,
    block: Block<(timer: NSTimer) => void>,
  ): NSTimer;
}
