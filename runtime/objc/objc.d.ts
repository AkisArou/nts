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
  import type { Class, ClassChain } from "c:types";
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
  // Runs on the main thread only: a block called, copied or released on
  // another thread ends the process by name, since the closure's count is
  // not atomic.
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

  export function objc_getClass(name: string): ClassObject | null;
  export function objc_allocateClassPair(superclass: ClassObject, name: string, extraBytes: c_size_t): ClassObject | null;
  export function objc_registerClassPair(cls: ClassObject): void;
  export function sel_registerName(name: string): Selector;
  /** `types` is the method's type encoding: `v@:@` for `- (void)name:(id)sender`. */
  export function class_addMethod(cls: ClassObject, name: Selector, implementation: Implementation, types: string): boolean;
}
