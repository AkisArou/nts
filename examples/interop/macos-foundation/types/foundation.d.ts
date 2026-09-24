// Hand-written, and a small part of Foundation: what the macos-foundation
// fixture sends. `nts bind-objc` (the Apple lane's A3) generates the real one
// from the SDK's headers; until then every selector here was checked by hand
// against the SDK's NSString.h, NSArray.h and NSObject.h.
//
// The shape is gtk-gir's. A class is a `Class` chain intersected with its
// methods, and each method names its selector and takes its instance as
// `this`. A class method is a function that names its class.
//
// Every class is an `ObjcClass`, so the compiler counts its objects: under the
// reference-counting provider each is released where its last TypeScript
// reference dies. Nothing here declares `retain` or `release`, which ARC
// reserves (a call to one is refused).
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { Opaque, c_ulong } from "c:types";
  import type { ObjcClass } from "objc:types";

  /** The class object `+class` answers, which `isKindOfClass:` takes. Not an
   * object the program counts: a class lives as long as the process. */
  export type ClassObject = Opaque<"objc_class">;

  export interface NSObjectOwnMethods {
    /**
     * @ntsSelector isKindOfClass:
     */
    isKindOfClass(this: NSObject, cls: ClassObject): boolean;
  }
  export type NSObjectMethods = NSObjectOwnMethods;
  export type NSObject = ObjcClass<"NSObject"> & NSObjectMethods;

  export interface NSStringOwnMethods {
    /**
     * @ntsSelector initWithUTF8String:
     */
    initWithUTF8String(this: NSString, text: string): NSString;
    /**
     * @ntsSelector length
     */
    length(this: NSString): c_ulong;
    /**
     * @ntsSelector UTF8String
     */
    UTF8String(this: NSString): string;
    /**
     * @ntsSelector uppercaseString
     */
    uppercaseString(this: NSString): NSString;
    /**
     * @ntsSelector isEqualToString:
     */
    isEqualToString(this: NSString, other: NSString): boolean;
  }
  export type NSStringMethods = NSStringOwnMethods & NSObjectMethods;
  export type NSString = ObjcClass<"NSString", NSObject> & NSStringMethods;

  export interface NSMutableArrayOwnMethods {
    /**
     * @ntsSelector addObject:
     */
    addObject(this: NSMutableArray, object: NSObject): void;
    /**
     * @ntsSelector count
     */
    count(this: NSMutableArray): c_ulong;
    /**
     * @ntsSelector objectAtIndex:
     */
    objectAtIndex(this: NSMutableArray, index: c_ulong): NSObject;
  }
  export type NSMutableArrayMethods = NSMutableArrayOwnMethods & NSObjectMethods;
  export type NSMutableArray = ObjcClass<"NSMutableArray", NSObject> & NSMutableArrayMethods;

  /**
   * @ntsSelector new
   * @ntsClass NSObject
   */
  export function newObject(): NSObject;
  /**
   * @ntsSelector alloc
   * @ntsClass NSString
   */
  export function allocString(): NSString;
  /**
   * @ntsSelector stringWithUTF8String:
   * @ntsClass NSString
   */
  export function stringWithUTF8String(text: string): NSString;
  /**
   * @ntsSelector class
   * @ntsClass NSString
   */
  export function classNSString(): ClassObject;
  /**
   * @ntsSelector class
   * @ntsClass NSMutableArray
   */
  export function classNSMutableArray(): ClassObject;
  /**
   * @ntsSelector arrayWithCapacity:
   * @ntsClass NSMutableArray
   */
  export function arrayWithCapacity(capacity: c_ulong): NSMutableArray;
}
