# Apple

macOS and iOS programs written in TypeScript against the surface Swift gives
an AppKit or UIKit programmer, compiled to native code and cross-built from
Linux. For anyone writing an Apple program for nts or binding an Apple
framework. It builds on the [native target](native.md) and its C interop;
[`../macos.md`](../macos.md) is the hands-on guide to writing a Mac app.

## Targets and products

| target | built for | product |
|---|---|---|
| `target.macos({ minimumVersion, arch })` | x86-64 and arm64 Mach-O | an executable, or `app.macos({ entry, id, minimumVersion })`: `<name>.app` with an `Info.plist` from `id` and `minimumVersion`, refused without an `id` |
| `target.ios({ minimumVersion, arch: "x86_64" })` | the iOS simulator | an application: a flat `<name>.app` the simulator installs |
| `target.ios({ minimumVersion })` (arm64) | a device | refused by name: it needs signing |

A shared library is a `.dylib` (`library.native`); an `.xcframework` product
is refused by name ([native](native.md#products)). Both backends build Apple
products, and a program that sends Objective-C messages is refused off Apple,
by name.

**The toolchain.** Everything is built on Linux:
`clang -target <arch>-apple-macos<min> -isysroot <sdk> -fuse-ld=lld` (the
simulator's triple for iOS), against an SDK copied from a Mac
(`tooling/apple/sync-sdk.sh`, or `NTS_APPLE_SDK`) or zig's Darwin libc
(`tooling/apple/zig-sdk.sh`). libuv is cross-built from
source. Swift's names for the SDK's frameworks come from symbol graphs
extracted on a Mac once per SDK (`tooling/apple/symbolgraph.sh`); a project's
own headers and Swift go through the open-source Swift toolchain on Linux, so
`nts build` never contacts a Mac.

## Objective-C from TypeScript

```ts
import { NSObject, NSWindow, type NSApplicationDelegate,
         type NSNotification } from "objc:AppKit";

class AppDelegate extends NSObject implements NSApplicationDelegate {
  applicationDidFinishLaunching(notification: NSNotification): void {
    console.log("launched");
  }
}

const window = new NSWindow({
  contentRect: { origin: { x: 200, y: 200 }, size: { width: 360, height: 300 } },
  styleMask: NSWindow.StyleMask.titled | NSWindow.StyleMask.closable,
  backing: NSWindow.BackingStoreType.buffered,
  defer: false,
});
window.title = "Notes";
```

- **Names are Swift's**, taken from Swift's symbol graphs and joined to clang's
  declarations: a member Swift does not import is absent, and one unavailable
  at the deployment target is skipped with the reason.
- **Labels** are one trailing object, which the compiler removes:
  `list.insert(n, { at: 0n })` is Swift's `insert(_:at:)`. A record argument
  may be written as its fields, as above.
- **Properties are messages:** `window.title = s` sends `setTitle:`.
- **A class is a value:** `new NSWindow(...)` is `+alloc` and the initializer;
  `instanceof` is `isKindOfClass:`; `delegate?.method?.()` asks
  `respondsToSelector:` first.
- **Blocks:** a function type in a message is a block, lent for the call and
  copied by a callee that keeps it; a block that is Swift's last argument is
  passed as a trailing closure. A block called off the main thread is carried
  to it. A call from another thread to a block that returns a value or takes a
  pointer is refused by name, as is a copy made there.
- **`async` and `throws`:** a method with a completion handler also has a form
  returning a `Promise`; a method reporting an `NSError **` throws an `Error`
  carrying its `localizedDescription`.
- **Collections:** an `NSArray` result reads as a TypeScript array, an
  `NSDictionary` as a `Map<string, V>`, an `NSSet` as a `Set<T>`, each copied.

**The call** is `objc_msgSend` cast to the exact function type of its
selector, at each call site, in C and in LLVM: never variadic, `_stret` for a
large record on x86-64 and never on arm64. Selectors and classes are cached by
static lookups, and a missing class ends the process by name. There is no
libffi and no run-time metadata.

**Subclasses and protocols.** `class Controller extends NSObject` is an
Objective-C class of the program's own, registered before `main`. A method's
selector follows Swift's `@objc` rule, or `@ntsSelector` gives it; an override
takes the selector of the method it overrides; `implements NSWindowDelegate`
adopts the protocol and answers its selectors. Fields and constructors work as
in Swift.

## Where the bindings come from

- **The platform's frameworks** (Core Graphics, Foundation and AppKit on
  macOS; Foundation and UIKit on iOS) are generated once per SDK and
  deployment target into the type store (`~/.cache/nts/types`: `@nts/apple-appkit`,
  `@nts/platform-macos`), and linked into the project's `node_modules/@nts`.
- **Anything else a program imports** (another framework, the project's own
  Objective-C or `@objc` Swift under `native:`, a SwiftPM or CocoaPods
  dependency read from its lockfile) is bound per program into `.nts/objc`,
  from the names its `objc:` imports name. A class reached only through a
  signature is added the first time the checker finds a member missing, and
  remembered in `names.json`. Nothing is committed.
- `nts bind-objc` runs the generator by hand, and `--witness` writes a C
  program that asks the Objective-C runtime for every message the binding
  sends ([CLI](../reference/cli.md#nts-bind-objc)).

**Swift.** `@objc` Swift is reached through the Objective-C binder, and
`@_cdecl` Swift through [`bind-c`](native.md#generating-a-binding-nts-bind-c).
Pure Swift (generic structs, SwiftUI, Swift's own `async`) needs a shim the
programmer writes. C reaches compiled TypeScript through
[`program.h`](native.md#c-calling-typescript); Swift calling TypeScript
directly is not built.

## The event loop

`NSApplication.run` or `UIApplicationMain` owns the main thread. The
CoreFoundation host (`nts_cf_host.c`) watches libuv's kqueue descriptor with a
`CFFileDescriptor`, arms a run-loop timer to libuv's next timeout, and re-arms
it before the loop waits, in the common modes, so event tracking and modal
panels keep libuv turning. Each pump runs inside its own autorelease pool. While
a callback is on the stack, a nested run loop runs no libuv task. A program
that sends no messages runs on plain libuv.

## Memory at the boundary

- **Objective-C objects are counted with ARC's rules.** Under reference
  counting a handle is retained where a second reference is taken and released
  where the last dies (`objc_retain`, `objc_release`). `alloc`, `new`, `copy`,
  `mutableCopy` and `init` hand over +1, and `init` consumes its receiver;
  anything else lends +0 and is retained when kept. `retain`, `release`,
  `autorelease`, `dealloc` and `retainCount` are refused on a counted object.
- A handle held in a heap object's field, or captured by a closure, is released
  when its holder dies, by the count or by the cycle collector. A class the
  program writes keeps its state in an instance variable released at
  `dealloc`.
- An autorelease pool surrounds the run of any program that sends messages,
  and each host task.
- **Cycles through blocks are not collected.** No holder family is registered
  for Objective-C: a stored block or handler that captures its owner leaks.
  AppKit's delegates and targets are weak by convention, which avoids the
  commonest cycles
  ([memory](../foundations/memory.md#cycles-through-foreign-objects), register
  [M-4](../open-questions.md#3-memory)).

## Strings at the boundary

In a message, a `string` is an `NSString`, as Swift's `String` is: an
argument's UTF-16 is lent, an `NSString` is made of it and released after the
send, and a result is read back through `UTF8String` and copied. `CString`
(`objc:types`) is a C string in a message; outside a message, a `string` is the
UTF-8 C string every [native](native.md#strings-at-the-boundary) binding
passes, and a C function's `NSString *` is `BridgedString`.

## Errors in callbacks

An exception escaping a delegate method, an action or a block is the program's
uncaught error. On Apple the rule is to report it and keep the run loop going;
that is not built, and the program stops with status 1. An `NSException`
reaches no `catch` yet ([errors](../language/errors.md#callbacks-a-host-invokes));
it is decided to become a catchable `Error` carrying the exception, once
unwinding through C frames is researched
([errors](../language/errors.md#decisions), register
[I-2](../open-questions.md#5-interop-and-hosts)).

## What has run where

Apple programs have run only on x86-64: on an Intel macOS VM and on the iOS
simulator there, on both backends, against Swift and Objective-C oracles.
arm64 Mach-O is built and inspected but has never run on Apple hardware; the record shapes it passes by AAPCS64 run on arm64 Linux under
qemu. No Mac is available now, so the Apple interop tests (`tests/interop/macos-*`,
`ios-*`) report `SKIP`.

## Open questions

- Cycles through blocks: [M-4](../open-questions.md#3-memory).
- `NSException` reaching a `catch`: [I-2](../open-questions.md#5-interop-and-hosts).

## Decisions

- macOS and AppKit first, iOS later; no Mac hardware and no hosted CI, a local
  VM runs what Linux builds
  ([notebook](../records/notebooks/apple-lane-goal.md)).
- The surface is Swift-shaped: Apple's importer supplies the names, bindings
  are classes, and labels are one trailing object; it replaces the
  NativeScript-shaped surface
  ([notebook](../records/notebooks/apple-lane-goal.md)).
- Apple programs may stay unrun at a landing whose only refusals are their
  platform skips ([log](../records/notebooks/decisions-log.md#team-and-process)).
- An exception escaping a callback on a UI target is reported, and the loop
  keeps running ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- No Mac is bought yet: Apple builds stay unrun at landing, and an
  Apple-silicon Mac mini is bought first when the macOS host work begins (A-1;
  10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- Surfaces derived from Apple's SDK are generated on each machine and never
  published (B-3; 10-28,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- Cycles through the Objective-C classes nts defines are collected in memory
  stage 7 (I-6; 10-28,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28));
  blocks wait on M-4.
