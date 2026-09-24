// Hand-written, and a small part of Foundation: what the macos-foundation
// fixture sends. `nts bind-objc` (the Apple lane's A3) generates the real one
// from the SDK's headers; until then every selector here was checked by hand
// against the SDK's NSString.h, NSArray.h and NSObject.h.
//
// The shape is gtk-gir's. A class is a `Class` chain intersected with its
// methods, and each method names its selector and takes its instance as
// `this`. A class method is a function that names its class.
//
// Ownership is manual in this version: `alloc`/`new`/`copy` return an object
// the caller releases, and everything else is borrowed from the autorelease
// pool the program pushes. Managed handles are A1b.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { Class, Opaque, c_ulong } from "c:types";

  /** The class object `+class` answers, which `isKindOfClass:` takes. */
  export type ObjcClass = Opaque<"objc_class">;

  export interface NSObjectOwnMethods {
    /**
     * @ntsSelector retain
     */
    retain(this: NSObject): NSObject;
    /**
     * @ntsSelector release
     */
    release(this: NSObject): void;
    /**
     * @ntsSelector isKindOfClass:
     */
    isKindOfClass(this: NSObject, cls: ObjcClass): boolean;
  }
  export type NSObjectMethods = NSObjectOwnMethods;
  export type NSObject = Class<"NSObject"> & NSObjectMethods;

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
  export type NSString = Class<"NSString", NSObject> & NSStringMethods;

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
  export type NSMutableArray = Class<"NSMutableArray", NSObject> & NSMutableArrayMethods;

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
  export function classNSString(): ObjcClass;
  /**
   * @ntsSelector class
   * @ntsClass NSMutableArray
   */
  export function classNSMutableArray(): ObjcClass;
  /**
   * @ntsSelector arrayWithCapacity:
   * @ntsClass NSMutableArray
   */
  export function arrayWithCapacity(capacity: c_ulong): NSMutableArray;
}
