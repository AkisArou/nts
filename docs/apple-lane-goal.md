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

**Measured 2026-09-24: the C interop examples on macOS.**
`tooling/apple/interop-on-mac.sh` mirrors each example outside the tree,
retargets the mirror to macos-13 x86_64, and runs the example's own `build.sh`
with the consumer compiled against the SDK and run on the VM. 16 examples
have the shape it needs.

| Result | Examples |
|---|---|
| **Pass on the Mac** (7) | c-from-ts, native-buffer, native-callback, native-closure, native-copy, native-fd, ts-from-c |
| **Pass, checked by hand** (1) | library-module-state: `_nts_auto_init` survives the Mach-O link and the caller prints `total=12`. The script fails only because GNU `nm` cannot read Mach-O. |
| **Refused by the witness, correctly** (6) | native-poll (`poll`), native-uname (`utsname`), native-stat (`stat`), native-rusage (`suseconds_t`), native-inet (glibc's `__in6_u`), native-epoll (no `sys/epoll.h`). Their bindings were generated from Linux headers, and a macOS build refuses them rather than miscompiling. |
| **Linux-only consumer** (1) | native-open: `caller.c` asserts Linux's `O_CREAT == 64`. |
| **Partly run** (1) | native-string: the main arm passes on the Mac. Its later arms call the caller inside `$(…)` and `valgrind`, which the harness does not redirect. |

Found by running these: `run.sh` passed one empty argument to a program given
none. `native-buffer`'s `argc` check caught it; `macos-hello` ignores its
arguments and could not.

## A1a, landed: Foundation from TypeScript

`cfc1f567`. A binding declares an Objective-C method as gtk-gir declares a C
one: on a handle's methods interface, with `this: T`, tagged
`@ntsSelector initWithUTF8String:` instead of `@ntsSymbol`. A class method is a
function tagged `@ntsSelector` and `@ntsClass NSString`, and the module names
what to link with `@ntsFramework Foundation`.

- **The call** is `objc_msgSend` cast to the exact function type, in C and in
  LLVM. It is never variadic. Selectors and classes are cached by `static`
  lookups, and a missing class ends the process by name.
- **Refused where the declaration is read:** a colon count that is not the
  message's argument count, a malformed selector, `@ntsClass` on a method, a
  function with no class, both `@ntsSymbol` and `@ntsSelector`, variadics, the
  managed ABI, and callbacks.
- **Link and target:** `-lobjc` and `-framework X`. A send off Apple is refused
  by name.
- **Measured on the VM:** `examples/interop/macos-foundation` prints exactly
  what `reference/foundation.c` prints, on both backends. That file sends the
  same messages from hand-written C against the same Foundation. A selector
  sabotage dies with `unrecognized selector`.

What A1a does not do is ownership: `release` is itself a send, called by hand.

## A1b, landed: the compiler owns Objective-C objects

`4f3581ec`, plus `1d741c19`, which made `nts build --rc` compile the runtime
with the provider it lowered for.

- **What is counted.** A handle is `ObjcClass<Tag, Parent>` (from
  `runtime/objc/objc.d.ts`), which is `Class`'s chain plus an `__objc` brand,
  so `Handle.family` is `Objc`. Under `--rc` it is retained where a second
  reference is taken and released where the last dies, with
  `objc_retain`/`objc_release`. Under NoGc it lives forever, like everything
  else there.
- **Ownership.** ARC's method families (`alloc`, `new`, `copy`,
  `mutableCopy`, `init`) hand over +1, and `init` consumes its receiver.
  Everything else lends +0 and is retained when kept.
- **One seam for other object systems.** `Family::counting()` names a
  family's functions, and `returns_owned`/`consumes` are generic facts on the
  native function. The GTK lane's `GObject` is one more arm.
- **Refused:** `retain`, `release`, `autorelease`, `dealloc` and
  `retainCount` on a counted object, and a +1 result nothing counts.
- **The pool.** `main.c` keeps an autorelease pool around the run of any
  program that sends messages. Every Mac run asserts an empty stderr.
- **Measured** by `macos-foundation`: zeroing weak references say `gone`
  under `--rc` and `alive` under NoGc, on both backends, against an
  ARC-placed C oracle. `objc_arc.rs` checks the same rules on any host,
  against a stub runtime.

**A1b.2, landed (`bb53d038`): handles in fields.** A handle held in a heap
object's field, or captured by a closure, is released when the holder dies.
`NtsDescriptor` carries a per-slot `NtsForeignSlot { offset, release }` table,
and `nts_free` gives the slots up, so it covers both the count reaching zero
and the cycle collector's sweep. Measured on the Mac (the `in a field` and
`captured` lines) and by the stub test, each with a sabotage that fails.
Making the LLVM descriptor type whole along the way cleared four examples'
partial comparisons.

**Speed items the benchmark will price, not guessed at:**
- a send is a cached load, a never-taken branch and a direct
  `objc_msgSend`, where clang uses `__objc_selrefs` fixed up at load;
- a +0 result is `objc_retain`ed, where clang's
  `objc_retainAutoreleasedReturnValue` handshake skips the pool.

**Never measured here: arm64 at run time.** The VM is x86_64. arm64 is built,
linked and inspected, and the lane never emits a variadic `objc_msgSend`, so
correctness does not depend on arm64 running by luck.

## Next

1. **A2, a window.** Landed so far:
   - **The run-loop host (`48faceb5`).** `nts_cf_host` turns libuv inside
     the main `CFRunLoop`, with a per-task autorelease pool.
     `examples/interop/macos-loop` runs `gtk-loop`'s four arms.
   - **Blocks (`6e177bd0`).** `Block<F>` becomes a clang-shaped stack block
     whose copy and dispose lend and give back the closure, guarded to the
     owning thread. `examples/interop/macos-blocks` matches an ARC oracle.
   - **Classes (`fb6496c1`).** A class is made at run time through the
     runtime's C API (`objc:runtime`), and each method is
     `imp_implementationWithBlock` over a TypeScript closure whose first
     parameter is `self`. `examples/interop/macos-subclass` matches an ARC
     oracle. Ownership follows ObjC's: a method closure lives as long as its
     class, which is forever. An instance is an ordinary counted object, so a
     target or delegate that Cocoa holds weakly stays alive only while
     TypeScript holds it. Nothing on our side adds a hidden strong edge.

   - **Records by value, C backend.** `ByValue<T>` in a binding: an argument
     is read from the storage it points at, and a result is written into a
     frame local, with `local<T>()`'s rules. A send returning one uses
     `objc_msgSend_stret` on x86_64 when it is over 16 bytes.
     `examples/interop/macos-geometry` matches an Objective-C oracle, and its
     control shows plain `objc_msgSend` failing at the send.
     `examples/interop/native-byvalue` covers each ABI class against C. The LLVM
     backend refuses by name until it classifies aggregates (SysV and AAPCS64,
     checked against `clang -emit-llvm`).

   - **A window (C backend).** `examples/interop/macos-window` puts an
     `NSWindow` with an `NSButton` on the Mac's screen. The button's action is
     a TypeScript closure, and each press starts an `await` and a
     `setTimeout`. All of it runs inside `[NSApp run]`, in JavaScript's order,
     and a control with libuv detached shows no timeout firing early. A
     program started over ssh reaches the logged-in session's WindowServer with
     no extra setup.

     It found a host bug. `performClick:` turns a nested run loop while the
     callback that called it is still running, and the CF host pumped libuv
     there, so a task started with TypeScript frames below it. The host now
     asks `nts_in_callback()` and runs nothing until the callback returns,
     which is also the rule for a modal panel opened from a handler. It is the
     trade-off the host already made for a modal loop inside a libuv task.

   - **Records by value on LLVM.** x86_64 System V classification, with the
     declarations checked against `clang -emit-llvm`. `macos-geometry` and
     `macos-window` each have an LLVM arm on the Mac, and `native-byvalue` one
     on Linux.

   **A2 is closed on both backends.** Still open from it: arm64 has never
   run, and the LLVM backend has no AAPCS64 classification, since it targets
   x86_64 only. `dispatch_async` needs `-fblocks` in the witness.

2. **The surface `bind-objc` will write, first.** The NativeScript shape needs
   the lowering to express it, and a generator targeting today's surface would
   be rewritten by A4. Landed so far:
   - **A class is a value.** `export const NSWindow: ObjcMeta<"NSWindow"> &
     NSWindowStatics` in an `objc:` module is the class object, read through
     the cached, required lookup, so `NSWindow.alloc()` is a message to it and
     class methods need no `@ntsClass` function. `macos-window` is written this
     way.

   - **Properties are messages.** A property signature in an `objc:` interface
     is read with its getter (its name, or `@ntsSelector isVisible` for a
     `getter=`) and written with `set` and the name capitalized, so
     `window.title = s` sends `setTitle:` and `window.frame` sends `frame`,
     `stret` included. A `readonly` property has no setter. `macos-window`
     uses both.

3. **A3: `nts bind-objc`, landed without its witness.** `nts bind-objc
   --module objc:AppKit --framework AppKit --framework Foundation --class
   NSWindow ...` writes the surface above from the SDK's headers, each class
   with its ancestors and its categories. It streams clang's whole-framework
   dump (388 MB for AppKit) in two passes, in about 6 s. `macos-window` runs on
   its output: every AppKit and Foundation declaration there is generated, and
   `build.sh` regenerates the file and fails on a diff. `NTS_REGENERATE=1`
   rewrites it.

   The rules, each with a test on a synthetic framework
   (`bind_objc::tests`):
   - A method takes its `NativeScript` name, and its selector is its
     `@ntsSelector`.
   - `instancetype` is the class a method is called on, and an ancestor's
     class methods and `instancetype` methods are repeated at each
     descendant's type.
   - Only a declared `_Nullable` may be null. An unannotated pointer is
     present, as Swift imports it: `+alloc` is unannotated.
   - An enum crosses as its fixed width's brand, and a struct by value is
     declared with `Struct`.
   - A member this cannot write is left out with the reason in a comment:
     blocks, `void *`, C function pointers, pointers to structs, variadic
     methods.

   Not yet:
   - The Objective-C witness (a `@selector` and `method_getTypeEncoding`
     check per member, run on the Mac).
   - Availability filtering. Clang's JSON carries no version on
     `AvailabilityAttr`.
   - Enum constants as values.
   - Protocols, so delegates are still declared by hand.
   - Blocks in generated signatures.
   - A lowering gap it found: an optional call (`window.contentView?.addSubview(v)`)
     on a native method takes its return type from the whole expression and
     is refused.
   It replaces the hand-written `.d.ts` in every `macos-*` fixture. Sugar for
   `class X extends NSObject` belongs to A4, and so does per-instance
   TypeScript state, and so does `NSMakeRect`-style construction. Today a
   rectangle is a `local<CGRect>()` filled member by member, and a helper that
   returns one is refused as an escaping local.

   **A live limit: `performSelector:` on a void method, read.** A +0 result
   nothing reads is left alone (`fb6496c1`), so the unread case is correct.
   A program that *reads* the result of a selector whose method returns
   `void` still retains whatever the return register held. The selector is a
   run-time value, so this cannot be refused statically. It is ObjC's own
   hazard, and A3's generated bindings, which know each method's real result,
   leave `performSelector:` as the one untyped escape hatch.
4. **The Swift-shaped surface (2026-09-24), replacing the NativeScript one.**
   The user's call, and it supersedes A4's naming. Names come from Apple's own
   importer (`swift-symbolgraph-extract` on the VM, joined to clang by USR),
   bindings are real classes, and labels are one trailing object that the
   compiler removes. Plan: S1 through S7 in the lane's plan file.
   - **S1, classes, landed.** A class a binding declares with `@ntsClass
     NSTimer` (TypeScript may call it `Timer`) is that Objective-C class. Its
     instances are ARC-counted handles, with the chain taken from `extends`.
     - `new C(...)` is `+alloc` then the constructor's `init`, or one class
       send for a factory constructor (`@ntsSelector +numberWithInt:`).
     - Methods, properties and `static` members are messages.
     - `instanceof` is `isKindOfClass:`.
     - A class the program writes over one is an Objective-C class of its own
       (S6, below).
     - `examples/interop/macos-classes` matches an ARC oracle on both
       backends, and its NoGc control differs only in `new`'s object living
       on.
   - **S2, labels, landed.** A parameter declared as an object type literal
     is a label list: `insert(object: NSObject, labels: { at: c_ulong })` is
     Swift's `insert(_:at:)`, called as `list.insert(n, { at: 0n })`. Each
     property is its own C slot, in the order the type declares them. At the
     call the literal is never built: its properties are lowered in the order
     they are written, as JavaScript evaluates them, and passed in the
     selector's order. Only a literal is accepted. It works for C functions
     too.
   - **S3a, numbers without casts, landed.** `objc:types` exports Swift's
     numbers (`Double`, `CGFloat`, `Int`, `UInt`, `Int32` and the rest,
     `TimeInterval`) as optional brands, `number & { readonly __c_double?:
     true }`. A plain `number` passes, and the call carries the brand's C type.
     `Int` is 64 bits over a `number`, so a value past 2^53 rounds as it does in
     any JavaScript bridge; the `bigint` brands in `c:types` keep every bit.
     `macos-classes` has no cast left.
   - **S3b, strings, landed.** In an Objective-C message a plain `string` is
     an `NSString`, as Swift's `String` is:
     - An argument's UTF-16 is lent, and an object is made of it
       (`CFStringCreateWithCharacters`, +1, released by the program's count
       after the send).
     - A result is read back through `UTF8String` and copied.
     - A C string in a message is `CString` (`objc:types`), and a C
       function's `string` is unchanged.
     - `bind-objc` writes `CString` for `char *`.
     - `macos-classes` appends, uppercases and names by `string` on both
       backends.

     Measured cost is still owed: a string crossing copies into an
     `NSString`, and the same copy Swift makes has not been compared yet.
   - **S4, `bind-objc` v2, landed.** The generator writes the Swift surface,
     and `macos-window` runs on it on both backends with no cast:
     `new NSWindow({ contentRect, styleMask: NSWindow.StyleMask.titled |
     NSWindow.StyleMask.closable, backing: .buffered, defer: false })`,
     `window.title = "nts"`, `Timer.scheduledTimer({ timeInterval: 0.05, ... })`.
     - Names are Swift's. `tooling/apple/symbolgraph.sh` fetches the importer's
       graphs once per SDK, and each member is joined to clang by USR. A member
       Swift does not import is absent. One deprecated by the deployment target,
       or introduced after it, is skipped with that reason.
     - An initializer is a constructor, a factory's included. A getter Swift
       imports as a property is one. `isHidden` carries `@ntsSet setHidden:`.
     - Enums nest where Swift nests them (`namespace NSWindow { const enum
       StyleMask }`), with clang's values. An `NS_OPTIONS` also takes `0`,
       Swift's `[]`.
     - TypeScript gives a class one member per name and hides a base's
       overloads. So a class declaring a name repeats its ancestors'
       overloads of it (`isEqual(_:)` beside `isEqual(to:)`), and repeats
       their initializers. Where Swift has a property and a method of one
       name (`menu`, `menu(for:)`), the property wins and the method is
       skipped with a reason.
     - Skipped, with reasons: blocks (S5), collections (S3c), members Swift
       throws or awaits (S5), and a label Swift repeats (`perform(_:with:with:)`).
     - The binding's cost to the checker: the 2.6k-line `macos-window`
       binding type-checks in 0.12 s, the same as `macos-classes`. The
       full-framework cost is still to be measured.
     - Found on the way: the binding's classes had entered the program's
       class hierarchy, and one override anywhere refused every C callback
       bridge. Both are fixed (`Layout::closure_call`).
   - **S3c, arrays of objects, first half landed.** `const views: NSView[]`
     holds Objective-C objects as Swift's `[NSView]` does.
     - The array owns one count of each element. A copy (`slice`,
       `concat`, spread) counts its own, an overwritten element is given up
       at once, and the elements go when the array does.
     - It is one mechanism for every counted family, GObject included. The
       runtime's `NTS_ARRAY_FOREIGN` elements count through their family's
       `NtsFamilyOps`, which the compiler emits once per family beside the
       counting pair, and to which an object's foreign slots now point too.
       Moves (`push`, `pop`, `splice`) reuse the `_ref` helpers, since a move
       changes no count.
     - `macos-classes` checks it against ARC on both backends, and its NoGc
       control differs in exactly the three lifetime lines.
     - **Bridging, as Swift's `[T]`.** A message's `NSArray` parameter takes a
       TypeScript array. It is copied into an `NSMutableArray` made for the
       call and released after it, with each string an `NSString` given up
       once added. An `NSArray` result is copied into a new array, each object
       counted by it and each string copied. Labels cross the same way, since
       a label now carries the role its type has (`Role::Label { inner }`).
       - `bind-objc` writes `NSView[]`, `string[]`, and `NSObject[]` for an
         untyped `NSArray`. Collection skips dropped from 46 to 10.
       - A nullable array *result* is still skipped, because Swift reads it
         as `[T]?`.
       - `macos-classes` checks all four directions against ARC, and
         `macos-window` reads `window.contentView?.subviews.length` in the
         running window.
     - Still owed:
       - Sets and maps of objects.
       - Dictionaries.
       - Each element *read* retains and releases around its use, where ARC
         passes a +0 borrow. That costs a count per read and holds the
         element to the end of the scope.
   - **S5a, closures as Swift's, landed.** In a message, a plain function
     type is a block, as a Swift closure passed to one is. It is lent for the
     call and copied by a callee that keeps it. `Block<F>` is no longer needed
     at a message, and a C function's function type is still a function
     pointer.
     - `bind-objc` reads clang's block spelling into a TypeScript function type,
       and a block that is Swift's last argument is passed after the labels,
       as Swift's trailing closure: `Timer.scheduledTimer({ withTimeInterval:
       0.05, repeats: true }, (timer) => ...)`.
     - A label may be a block too.
     - Skipped, with reasons: a block taking a `BOOL *` (Swift's
       `UnsafeMutablePointer<ObjCBool>`) and a block result.
     - `macos-window`'s timer is now that trailing closure, kept by the timer
       and called from the run loop, and `macos-classes` sorts with
       `list.sort((a, b) => ...)` against ARC.
   - **S5b, `throws`, landed.** Swift leaves out a method's trailing
     `NSError **`, and so does the binding. `@ntsThrows error
     nts_nserror_message` naming no parameter makes the compiler supply the
     slot. A reported error is thrown as an `Error` whose message is its
     `localizedDescription`, read by the CF host's `nts_nserror_message`.
     - As in Swift, a throwing `BOOL` method returns nothing, and a throwing
       object result is not optional.
     - `macos-classes` lists a directory and catches the error for a missing
       one, against ARC.
     - Async (completion handler to `Promise`) is next.
   - **S7, the witness, landed.** `nts bind-objc --witness out.c` writes, from
     the same model the binding is written from, a plain C program that asks
     the Mac's Objective-C runtime for every message the binding sends. That
     covers each method, and each property's getter and setter, on the class
     or an instance, with its arity. The headers say what a class declares;
     only the runtime says what it implements.
     - `macos-window` builds and runs it and compares the result with
       `witness.expected`. Of 1143 messages, the runtime lacks 20, each
       explained there. Two are installed lazily at a view's first `init`.
       Eighteen are declared and not implemented: informal-protocol
       categories and one setter. Swift exposes them too.
     - A control with a bogus selector is caught.
   - **S6, subclasses, first half landed.** `class Controller extends NSObject
     { pressed(sender: NSObject): void { ... } }` is Swift's `class
     Controller: NSObject`: an Objective-C class of the program's own,
     registered under its own name before `main`, whose instances are the
     runtime's objects.
     - Each method's selector follows Swift's `@objc` rule (`pressed(sender)`
       is `pressed:`), or `@ntsSelector` gives it.
     - The runtime calls the method through an entry point the backend
       builds over the compiled method (`self`, `_cmd`, then the arguments,
       with clang's type encoding).
     - A call the program writes goes straight to the compiled method, and
       `new Controller()` is the inherited `alloc`/`init`.
     - The lowering records it as data (`Program::objc_classes`), and each
       backend emits the entry points, a table and one constructor, calling
       the CF host's `nts_objc_register_class`. The JVM refuses it by name.
     - `macos-window`'s button target is now this class. AppKit sends it
       `pressed:` on both backends, the nested-loop arm included, which
       replaces the runtime-API controller it had.
     - It is the window's delegate too: `windowWillClose(notification)` is
       Swift's `windowWillClose(_:)`, whose selector a one-argument method
       gets by the same rule, and AppKit sends it when the timer closes the
       window. A delegate with a method of more than one argument waits for
       protocols, whose declarations name the selector.
     - Refused by name until the second half: a field (the runtime's object
       has no room for one yet), a constructor, a static member, an accessor,
       `super` calls, and protocols (`implements NSWindowDelegate`), which
       will build on GTK's `__c_implements`.
   - **Against Swift, measured (2026-09-25).**
     `examples/interop/macos-bench/bench.sh` runs the same loops in
     TypeScript and in Swift (`reference/bench.swift`, `swiftc -O`) on the
     lane's Mac. Rounds are interleaved and the median of 7 is taken, since
     the VM's timings move by 2x.

     | row | nts | Swift | ratio |
     |---|---|---|---|
     | send (`number.intValue`) | 3.2 ns | 3.1 ns | 1.03 |
     | string-set (`op.name = "worker"`) | 539 ns | 524 ns | 1.03 |
     | string-get (`op.name.length`) | 48.8 ns | 40.3 ns | 1.21 |
     | array-out (`components(separatedBy:)`, 64 strings) | 10.5 us | 12.3 us | 0.86 |
     | array-in (`path(withComponents:)`, 64 strings) | 2.68 us | 2.72 us | 0.98 |
     | objects-in (`addObjects(from:)`, 4 objects) | 120 ns | 329 ns | 0.36 |

     - The first measurement had string-get at 2.20 and array-in at 1.77.
       The bridging was a UTF-8 round trip and a message per element built
       in the lowering.
     - It is now CoreFoundation in the CF host (`nts_nsstring_of`,
       `nts_string_of_nsstring`, `nts_nsarray_of_*`,
       `nts_array_fill_*from_nsarray`). A string is copied from its own
       one-byte or two-byte storage, a short ASCII one in one call, and an
       array is one `CFArrayCreate` over the elements' own block.
     - What is left in string-get is an allocation Swift does not make: its
       `String` holds up to 15 bytes inline, and ours is always on the heap.
   - **Optional chaining, as Swift's.** `window.contentView?.addSubview(button)`
     and `operation?.name ?? "unnamed"` send nothing to an absent receiver, and
     the chain is `undefined`. The checker adds that `undefined` to every
     link's type. A message has none, so the link is sent at the method's own
     type and the branch around it makes the chain's. A longer chain
     (`a?.b?.c`) is lowered as one short-circuit, so an intermediate never
     forms a union with two absences (MainClaude's call: no new tags).
     - `a?.b.c`, `a?.b?.c()` and `xs?.[1]?.[0]` all work. Each `?.` tests its
       receiver innermost first, and what follows is lowered in the arm where
       it is present, so every merge is at the chain's own type.
     - Twelve chain shapes agree with node (`tooling/sweep/probe.sh`), and the
       receiver is evaluated once.
     - `f?.()` inside a longer chain is refused by name.
     - The probes found a pre-existing wrong answer in `erase` of a nullable
       reference (`t?.mid?.leaf === null` is `false`), which is reported to
       MainClaude.
   - **Objective-C handles narrow and assert.** `instanceof` narrows an
     Objective-C object to a subclass, and `as` asserts one, unchecked as every
     TypeScript assertion is. Any other opaque pointer is still refused.

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
