// Hand-written: Foundation classes as TypeScript classes, each member checked
// by hand against the SDK's headers. `nts bind-objc` will write this shape.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { c_int, c_ulong } from "c:types";

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
    constructor(text: string);
    readonly length: c_ulong;
    readonly uppercaseString: NSString;
  }

  /** @ntsClass NSNumber */
  export class NSNumber extends NSObject {
    /**
     * A class method, which Swift imports as `init(value:)`.
     * @ntsSelector +numberWithInt:
     */
    constructor(value: c_int);
    readonly intValue: c_int;
  }

  /** @ntsClass NSMutableArray */
  export class NSMutableArray extends NSObject {
    /** @ntsSelector addObject: */
    addObject(object: NSObject): void;
    readonly count: c_ulong;
  }

  /** @ntsClass NSOperation */
  export class NSOperation extends NSObject {
    name: NSString | null;
  }

  /** @ntsClass NSProcessInfo */
  export class NSProcessInfo extends NSObject {
    static readonly processInfo: NSProcessInfo;
    readonly processorCount: c_ulong;
  }
}
