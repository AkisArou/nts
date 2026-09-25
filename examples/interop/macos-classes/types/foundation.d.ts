// Hand-written: Foundation classes as TypeScript classes, each member checked
// by hand against the SDK's headers. `nts bind-objc` will write this shape.
/**
 * @ntsFramework Foundation
 */
declare module "objc:Foundation" {
  import type { CString, Int, Int32, ObjCBool, UInt } from "objc:types";
  import type { ByValue, Ptr, Struct } from "c:types";

  // Swift's `NSRange`, C's `struct _NSRange`.
  export type NSRange = Struct<{ location: UInt; length: UInt }, "_NSRange">;

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
    /**
     * Swift's `getLineStart(_:end:contentsEnd:for:)`: three numbers written
     * through the addresses passed, each an `UnsafeMutablePointer<Int>`.
     * @ntsSelector getLineStart:end:contentsEnd:forRange:
     */
    getLineStart(start: Ptr<UInt> | null, labels: { end: Ptr<UInt> | null; contentsEnd: Ptr<UInt> | null; for: ByValue<NSRange> }): void;
    /** Swift's `String`, both ways: a `string` crosses as an `NSString`. */
    readonly uppercaseString: string;
    /** @ntsSelector stringByAppendingString: */
    appending(other: string): string;
    /**
     * Swift's `[String]`, both ways: an `NSArray` of `NSString`s.
     * @ntsSelector componentsSeparatedByString:
     */
    components(labels: { separatedBy: string }): string[];
    /** @ntsSelector pathWithComponents: */
    static path(labels: { withComponents: string[] }): string;
    /** @ntsSelector dataUsingEncoding: */
    data(labels: { using: UInt }): NSData | null;
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
    /**
     * Swift's `[Any]`, both ways.
     * @ntsSelector addObjectsFromArray:
     */
    addObjects(labels: { from: NSObject[] }): void;
    /** @ntsSelector arrayByAddingObjectsFromArray: */
    adding(labels: { contentsOf: NSObject[] }): NSObject[];
    /**
     * Swift's trailing closure, `sort { a, b in ... }`: a block made of the
     * function for the call.
     * @ntsSelector sortUsingComparator:
     */
    sort(comparator: (a: NSObject, b: NSObject) => Int): void;
    /** @ntsSelector objectAtIndex: */
    object(at: UInt): NSObject;
    readonly count: UInt;
  }

  /** @ntsClass NSOperation */
  export class NSOperation extends NSObject {
    name: string | null;
    readonly isCancelled: boolean;
    /** @ntsSelector cancel */
    cancel(): void;
  }

  /** @ntsClass NSFileManager */
  export class FileManager extends NSObject {
    /** @ntsSelector defaultManager */
    static readonly default: FileManager;
    /**
     * Swift's `contentsOfDirectory(atPath:) throws -> [String]`: the
     * `NSError **` left out, and a reported error thrown.
     * @ntsSelector contentsOfDirectoryAtPath:error:
     * @ntsThrows error nts_nserror_message
     */
    contentsOfDirectory(labels: { atPath: string }): string[];
    /**
     * Swift's `subpaths(atPath:) -> [String]?`: nil, so `null`, for a path
     * that is not there.
     * @ntsSelector subpathsAtPath:
     */
    subpaths(labels: { atPath: string }): string[] | null;
    /**
     * Swift's `fileExists(atPath:isDirectory:)`, whose second is an
     * `UnsafeMutablePointer<ObjCBool>` the method writes.
     * @ntsSelector fileExistsAtPath:isDirectory:
     */
    fileExists(labels: { atPath: string; isDirectory: Ptr<ObjCBool> | null }): boolean;
  }

  /** @ntsClass NSAttributedString */
  export class NSAttributedString extends NSObject {
    /** @ntsSelector initWithString: */
    constructor(string: string);
    /**
     * Swift's `attribute(_:at:effectiveRange:)`, whose range is an
     * `UnsafeMutablePointer<NSRange>` the method writes: the address a
     * program passes, `local<NSRange>()`.
     * @ntsSelector attribute:atIndex:effectiveRange:
     */
    attribute(name: string, labels: { at: UInt; effectiveRange: Ptr<NSRange> | null }): NSObject | null;
  }

  /** @ntsClass NSPredicate */
  export class NSPredicate extends NSObject {
    /**
     * Swift's `init(format:argumentArray:)`, whose `[Any]?` takes nil.
     * @ntsSelector +predicateWithFormat:argumentArray:
     */
    constructor(labels: { format: string; argumentArray: NSObject[] | null });
    readonly predicateFormat: string;
  }

  /** @ntsClass NSData */
  export class NSData extends NSObject {
    readonly length: UInt;
  }

  /**
   * Swift's `XMLParserDelegate`: a protocol, which a class the program writes
   * adopts with `implements`, each method at the selector declared here.
   */
  export interface NSXMLParserDelegate {
    /** @ntsSelector parser:didStartElement:namespaceURI:qualifiedName:attributes: */
    parserDidStartElement?(parser: NSObject, elementName: NSString, namespaceURI: NSString | null, qualifiedName: NSString | null, attributes: NSObject): void;
  }

  /** @ntsClass NSXMLParser */
  export class XMLParser extends NSObject {
    /** @ntsSelector initWithData: */
    constructor(labels: { data: NSData });
    delegate: NSObject | null;
    /** @ntsSelector parse */
    parse(): boolean;
  }

  /** @ntsClass NSProcessInfo */
  export class NSProcessInfo extends NSObject {
    static readonly processInfo: NSProcessInfo;
    readonly processorCount: UInt;
  }
}
