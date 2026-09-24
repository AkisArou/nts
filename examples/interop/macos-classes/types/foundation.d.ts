// Hand-written: Foundation classes as TypeScript classes, each member checked
// by hand against the SDK's headers. `nts bind-objc` will write this shape.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { CString, Int32, UInt } from "objc:types";

  /** @ntsClass NSObject */
  export class NSObject {
    /** @ntsSelector init */
    constructor();
    /** @ntsSelector isEqual: */
    isEqual(object: NSObject | null): boolean;
  }

  /** @ntsClass NSString */
  export class NSString extends NSObject {
    /** @ntsSelector initWithUTF8String: */
    constructor(text: CString);
    readonly length: UInt;
    /** Swift's `String`, both ways: a `string` crosses as an `NSString`. */
    readonly uppercaseString: string;
    /** @ntsSelector stringByAppendingString: */
    appending(other: string): string;
  }

  /** @ntsClass NSNumber */
  export class NSNumber extends NSObject {
    /**
     * A class method, which Swift imports as `init(value:)`.
     * @ntsSelector +numberWithInt:
     */
    constructor(value: Int32);
    readonly intValue: Int32;
  }

  /** @ntsClass NSMutableArray */
  export class NSMutableArray extends NSObject {
    /** @ntsSelector addObject: */
    addObject(object: NSObject): void;
    /**
     * Swift's `insert(_:at:)`: the first argument unlabelled, the rest in one
     * object the compiler never builds.
     * @ntsSelector insertObject:atIndex:
     */
    insert(object: NSObject, labels: { at: UInt }): void;
    /** @ntsSelector objectAtIndex: */
    object(at: UInt): NSObject;
    readonly count: UInt;
  }

  /** @ntsClass NSOperation */
  export class NSOperation extends NSObject {
    name: string | null;
  }

  /** @ntsClass NSProcessInfo */
  export class NSProcessInfo extends NSObject {
    static readonly processInfo: NSProcessInfo;
    readonly processorCount: UInt;
  }
}
