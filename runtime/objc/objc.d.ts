// Hand-written. The Objective-C half of `c:types`: what makes a handle an
// object the program counts.
//
// `ObjcClass<"NSString", NSObject>` is `Class<"NSString", NSObject>`, with
// the same chain, the same upcasts and the same checked downcast, plus one
// brand that says whose object it is. Under the reference-counting provider
// the compiler retains it where a second reference is taken and releases it
// where the last one dies (`objc_retain`/`objc_release`). ARC's method
// families decide what a message hands back: `alloc`, `new`, `copy`,
// `mutableCopy` and `init` hand over an object the caller owns, and every
// other message lends one. So a binding never declares `retain`, `release`,
// `autorelease`, `dealloc` or `retainCount`, and a call to one is refused.
declare module "objc:types" {
  import type { Class, ClassChain, CNumber } from "c:types";
  import type { ClassObject } from "objc:runtime";

  export type ObjcClass<Tag extends string, Parent extends ClassChain | null = null> = Class<Tag, Parent> & {
    readonly __objc: true;
  };

  // A TypeScript function where Objective-C takes a block, `void (^)(A...)`.
  // The block is built in the caller's frame, as clang builds `^{ ... }`, and
  // the closure is lent to it for the call. A callee that keeps the block
  // copies it, and the copy keeps the closure alive until the block runtime
  // releases it. The closure may capture: what it sees of a `let` is the
  // variable, not a snapshot.
  //
  // The closure runs on the thread that made it, since its count is not
  // atomic. A block the platform calls on another thread -- a completion
  // handler on a background queue -- is carried there (`nts_block_carry`),
  // and so is its release. What cannot be carried ends the process by name:
  // a copy made on another thread, and a call there to a block that returns
  // a value or is given a pointer into memory the caller owns (`BOOL *stop`).
  export type Block<F extends (...args: never[]) => unknown> = F & { readonly __c_closure?: "block" };

  // The class object of `Tag`: what `NSWindow` means as a value, so that
  // `NSWindow.alloc()` is a message to it. A binding declares one as
  //
  //     export const NSWindow: ObjcMeta<"NSWindow"> & NSWindowStatics;
  //
  // inside its `declare module "objc:..."`, where the statics interface holds
  // the class methods, each taking `this` as the meta. Reading the constant
  // is the class lookup the program already caches for its sends: once, and
  // required, so a class that is not loaded ends the process by name rather
  // than answering every message with nil. A class object is never counted.
  export type ObjcMeta<Tag extends string> = ClassObject & { readonly __objc_meta: Tag };

  // Swift's numbers, as a binding spells a parameter or a property: a plain
  // `number` passes with no cast, and crosses as the C type named, by the one
  // definition `c:types` gives every binding (`CNumber`). An integer past 2^53
  // rounds, as it does in any bridge to JavaScript; the `bigint` brands in
  // `c:types` keep every bit where that matters.
  export type Double = CNumber<"double">;
  export type Float = CNumber<"float">;
  /** `CGFloat` is `double` on every 64-bit Apple target. */
  export type CGFloat = Double;
  /** `NSTimeInterval`, seconds. */
  export type TimeInterval = Double;
  /** `NSInteger`, 64 bits. */
  export type Int = CNumber<"long">;
  /** `NSUInteger`, 64 bits. */
  export type UInt = CNumber<"ulong">;
  export type Int8 = CNumber<"int8">;
  export type UInt8 = CNumber<"uint8">;
  export type Int16 = CNumber<"int16">;
  export type UInt16 = CNumber<"uint16">;
  export type Int32 = CNumber<"int32">;
  export type UInt32 = CNumber<"uint32">;
  export type Int64 = CNumber<"int64">;
  export type UInt64 = CNumber<"uint64">;

  // A C string where an Objective-C message takes a `const char *`: in a
  // message a plain `string` is an `NSString`, as Swift's `String` is, so
  // the rare `char *` says so. A plain string passes; it crosses as UTF-8.
  export type CString = string & { readonly __c_utf8?: true };
}

// Hand-written. The Objective-C runtime's C API: what defining a class at run
// time takes. A TypeScript class that extends NSObject is one of these, with
// each method's implementation a block (`implementationWithBlock`) whose first
// parameter is `self`. The runtime copies the block, so the closure lives as
// long as the class, which is as long as the process.
//
// Declared with no `@ntsHeader`, on purpose: `BOOL` is `signed char` on
// x86_64 and `bool` on arm64, so no one declaration matches `objc/runtime.h`
// on both, and the witness would refuse the one that does not. The types here
// are ABI-identical on both instead (every handle is a pointer, and `BOOL` is
// returned as 0 or 1 in the low byte, which `boolean` reads).
declare module "objc:runtime" {
  import type { Opaque, c_size_t } from "c:types";

  /** A class object: `Class`. Not counted; a class lives as long as the process. */
  export type ClassObject = Opaque<"objc_class">;
  /** A selector: `SEL`. */
  export type Selector = Opaque<"objc_selector">;
  /** A method implementation: `IMP`. */
  export type Implementation = Opaque<"objc_imp">;
  /** A protocol: `Protocol *`. Not counted; a protocol lives as long as the process. */
  export type ProtocolObject = Opaque<"objc_protocol">;

  export function objc_getClass(name: string): ClassObject | null;
  export function objc_allocateClassPair(superclass: ClassObject, name: string, extraBytes: c_size_t): ClassObject | null;
  export function objc_registerClassPair(cls: ClassObject): void;
  export function sel_registerName(name: string): Selector;
  export function objc_getProtocol(name: string): ProtocolObject | null;
  export function class_conformsToProtocol(cls: ClassObject, protocol: ProtocolObject): boolean;
  /** `types` is the method's type encoding: `v@:@` for `- (void)name:(id)sender`. */
  export function class_addMethod(cls: ClassObject, name: Selector, implementation: Implementation, types: string): boolean;
}
