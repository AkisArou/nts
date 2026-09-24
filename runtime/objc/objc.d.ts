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
}
