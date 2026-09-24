# The Apple lane's goal

Written 2026-09-23 by the Apple lane session. It works beside MainClaude
(language features, test262) and the GTK lane. The user decided three things:

- **macOS/AppKit first**, iOS later.
- **The product is an idiomatic, NativeScript-shaped TypeScript API over
  Cocoa:** `NSWindow.alloc().initWithContentRect…`, `class Delegate extends
  NSObject`, with ARC tied to the TypeScript value. The typed `objc_msgSend`
  layer is scaffolding for that, not the product.
- **No Mac hardware and no hosted CI.** A local quickemu macOS VM runs what
  this box builds (`tooling/apple/vm.md`).

The lane may edit compiler and runtime code. It announces each edit to a
shared file to MainClaude first, and agrees with the GTK lane on the pieces
both need before either builds them.

## How TypeScript meets Objective-C and Swift

Everything rides on the C interop that already exists: `c:` modules, `nts
bind-c`, the witness, and `program.h` for C calling TypeScript.

- **TS → ObjC.** A method call is `objc_msgSend(receiver, selector, args…)`,
  and it must be called through a cast to the exact function type of that
  selector; calling it variadically is wrong on arm64. Every call's type is
  known at compile time, so the C backend emits a typed cast at each site.
  Selectors are registered once. There is no libffi and no runtime metadata,
  which is where this differs from NativeScript.
- **Ownership.** An ObjC object is a handle with ARC semantics. The method
  family decides it: `alloc`/`new`/`copy`/`mutableCopy`/`init` return +1, and
  everything else returns +0. Storing a handle retains it and dropping it
  releases it, and an autorelease pool drains around every host task and
  bridge.
- **ObjC → TS.** A TS closure becomes a block: the Blocks ABI layout, with
  copy/dispose calling the GTK lane's `nts_closure_lend`/`unlend`.
  `class X extends NSObject` becomes a class registered with the ObjC runtime
  at module init, whose methods are generated C trampolines.
- **The run loop.** `NSApplication.run` drives the program, and libuv is
  embedded in CFRunLoop through the shared foreign-loop core the GTK lane is
  writing (a CF adapter here, a GSource adapter there).
- **Swift.**
  - `@objc` Swift is reached through `swiftc -emit-objc-header` and the ObjC
    binder.
  - `@c`/`@_cdecl` Swift is plain C through `bind-c`.
  - Pure Swift (generic structs, SwiftUI, async) needs a Swift shim the user
    writes. That is a stated limit.
  - Swift calls TypeScript through `program.h` plus a `module.modulemap`.

## Where it stands: A0, landed

`5824a285` and `f2312112`.

- **Why nothing built before.** The refusal blamed a missing SDK. The actual
  cause was the runtime's own `_POSIX_C_SOURCE` hiding `malloc_zone_t` from
  Darwin's `malloc.h`, and `_DARWIN_C_SOURCE` fixes it.
- **How macOS builds now.** Cross-built from Linux with
  `clang -target <arch>-apple-macos<min> -isysroot <sdk> -fuse-ld=lld`. The
  sysroot is a real SDK (`NTS_APPLE_SDK`) or zig's Darwin libc
  (`tooling/apple/zig-sdk.sh`). libuv is cross-built from the vendored copy.
- **Linker.** `link_c` speaks ld64: `-dynamiclib`,
  `-exported_symbols_list`, `-install_name @rpath/…`, `-dead_strip`, and
  `llvm-ar --format=darwin` for archives.
- **`examples/interop/macos-hello`** is one program built for Linux, macOS
  x86_64 and macOS arm64.
  - The Linux run matches node byte for byte.
  - The Mach-O slices are checked for CPU, libSystem-only loads and
    `minos 13.0`.
  - The x86_64 slice runs on a Mac when one is reachable.

**Measured 2026-09-24: an nts program runs on macOS.** On the lane's VM
(macOS 26.6, x86_64, full Xcode with the 26.5 SDK), `macos-hello`'s x86_64
slice prints node's output byte for byte. It does so when built against the
zig-derived sysroot and when built against the real SDK copied back by
`tooling/apple/sync-sdk.sh`. Control: the arm64 slice sent to the same VM
fails with `bad CPU type in executable` (exit 127), so the run arm reports a
failure rather than printing whatever it was given.

**Never measured here: arm64 at run time.** The VM is x86_64. arm64 is built,
linked and inspected, and the lane never emits a variadic `objc_msgSend`, so
correctness does not depend on arm64 running by luck.

## Next

1. **A0, remainder:** the existing C interop fixtures with a macOS target.
   `native-poll` and `native-stat` apply; `native-epoll` does not.
2. **A1, Foundation from TypeScript:**
   - an `objc:` specifier;
   - typed `objc_msgSend` lowering;
   - a family marker on the GTK lane's `Handle` (`c` or `objc`), which decides
     the spelling, the downcast check, and retain/release;
   - `NSString` ↔ `string`;
   - hand-written declarations for about 15 Foundation classes.

   Fixture `macos-foundation`: `α😀` round-trips through NSString, and a
   retain-count arm fails when release is skipped.
3. **A2, a window:** blocks, `extends NSObject`, the CFRunLoop host, and
   `macos-window` with a capturing target/action handler that starts a timer
   and an await.
4. **A3:** `nts bind-objc` from SDK headers, with an ObjC witness.
5. **A4:** the idiomatic layer, Swift in both directions, an `.app`, and a
   benchmark against NativeScript and Swift.

## Rules this lane keeps

These come from `native-lane-goal.md` and the GTK lane: two arms per claim, one
variable per arm, and assertions on the artifact rather than the status. Commits
use explicit paths and stage only this lane's hunks. Builds and tests run from a
worktree at HEAD plus only this lane's change (`~/.cache/nts/apple/wt`), because
the shared tree always holds someone's uncommitted work.

One rule is specific to Apple: **a result that did not run on a Mac says so.**
"Links" is not "runs", and an x86_64 run is not an arm64 run.
