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
     selector's order. Labels passed any other way, such as a variable or a
     wrapper's parameter, are an object, and each label is read from its
     field at the call. That is how an `async` wrapper in a values module
     passes on the labels it was given. It works for C functions too.
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
       name (`menu`, `menu(for:)`), the property keeps the name. The method
       takes its first label into its name, as its selector does:
       `menuFor(event)`, `frameForAlignmentRect(rect)`, `uppercasedWith(locale)`.
       Where the first argument has no label, the first label there is:
       `splitView(_:canCollapseSubview:)` is
       `splitViewCanCollapseSubview(splitView, subview)`. One of AppKit's
       former 45 has no label at all and is still skipped.
     - Overloads Swift tells apart by a number's type, such as `set(_:
       Int, forKey:)` and `set(_: Double, forKey:)`, are ordered double
       first, then float, then integer. TypeScript takes the first overload a
       call fits, and a JavaScript number is a double, so `set(1.5, ...)`
       reaches `setDouble:forKey:` and does not truncate through
       `setInteger:`.
     - Skipped, with reasons: blocks (S5), collections (S3c), and members
       Swift throws or awaits (S5).
     - A label Swift repeats, which one object cannot hold twice, takes its
       parameter's name from the header the second time.
       `NSLayoutConstraint(item:attribute:relatedBy:toItem:attribute:...)` is
       `{ item, attribute, relatedBy, toItem, attr2, multiplier, constant }`.
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
       - Swift's `[T]?` is `T[] | null`, both ways. A nil `NSArray` result
         is `null` and is neither counted nor filled. A `null` argument is sent
         as nil. `macos-classes` reads `subpaths(atPath:)` of a missing path
         as `null`, and sends `NSPredicate(format:argumentArray:)` both a
         `null` and an array. The AppKit binding gains `childWindows` and
         five more members, and the witness has all six.
       - A record parameter by address, Swift's `UnsafeMutablePointer<NSRange>`,
         is `Ptr<NSRange>`, which a program passes as `local<NSRange>()`. A
         send does not keep it past the call, as Swift's own `&range`
         promises. A record takes Swift's name where its tag is underscored
         (`NSRange`, `struct _NSRange`). 39 more AppKit members bind this
         way. `macos-classes` reads the range `attribute(_:at:effectiveRange:)`
         writes, against clang, on both backends.
       - A number parameter by address, `UnsafeMutablePointer<CGFloat>` in
         Swift, is `Ptr<CGFloat>`, read as `[0]`. It was spelled as the
         number itself until f998014f. 26 more members bind.
         `macos-classes` reads the three numbers `getLineStart` writes.
       - `BOOL *` is `Ptr<ObjCBool>`, Swift's `UnsafeMutablePointer<ObjCBool>`,
         as a parameter (`fileExists(atPath:isDirectory:)`) and as a block's
         `stop`, which the closure writes. `macos-blocks` ends an enumeration
         after its second element, as clang's does.
       - A generic class's type parameter stands for what it is declared
         as, `id`, so an object: `NSDiffableDataSourceSnapshot<SectionIdentifierType,
         ItemIdentifierType>`'s `itemIdentifiers` is `NSObject[]`, and the
         collection view's item provider binds.
       - An element through a typedef of `NSString *`, such as
         `[NSPasteboard.PasteboardType]`, is a `string`. A class qualified by a
         protocol, such as `NSView<NSCollectionViewElement>`, is the class.
         Array skips across AppKit dropped from 56 to 22.
       - `macos-classes` checks all four directions against ARC, and
         `macos-window` reads `window.contentView?.subviews.length` in the
         running window.
     - Still owed:
       - Sets and maps of objects.
       - Dictionaries.
       - Each element *read* retains and releases around its use, where ARC
         passes a +0 borrow. That costs a count per read, and holds the
         element to the end of its *block*. Measured (2026-09-25): neither
         `own.rs` nor the callee's retention decides it (`@ntsNoEscape`
         changes nothing), but `rc.rs`'s placement. A value that dies
         mid-block is released at the block's end, which in straight-line
         code is the function's. Reported to MainClaude as an `rc.rs`
         placement change.
       - That change landed (2026-09-25): a managed value is released after
         its last use. A **foreign** object deliberately keeps the block's
         end, because the platform may hold it without a count. The XML
         arm's delegate sits in an `assign` property, and releasing it at its
         last use crashed `parse()`. So an element read out of an `NSArray`
         still lives to its block's end. Swift's answer for this is a +0
         borrow, and the next step is `own.rs` borrowing an element read
         that never escapes, not a shorter lifetime.
   - **S5c, `async` as Swift's, landed (2026-09-25).**
     `const response = await window.beginSheet(sheet)` is Swift's import of
     `beginSheet:completionHandler:`.
     - Swift's symbol graph holds both forms under one USR, the `async` one
       marked in its declaration. `bind-objc` binds the method taking the
       handler, and beside it an overload returning `Promise<T>`, tagged
       `@ntsCall`.
     - The overload's body is in the values module the generator writes
       beside the binding (`--values appkit.values.ts`): `new Promise((resolve)
       => self.beginSheet(sheet, (value) => resolve(value)))`. So the
       machinery is the block S5a already builds, copied by AppKit and called
       later.
     - A block's parameter spelled through a typedef (`NSModalResponse`) is
       read through the headers' typedefs, to its width. Swift's
       `NSApplication.ModalResponse` wrapper is not modelled; it crosses as
       `Int`.
     - `macos-window` begins a sheet and ends it with return code 1001 in
       the last tick. The awaited 1001 prints at that callback's checkpoint,
       after `closing` and before `done`, on both backends.
     - **`async throws` too.** A handler given an `NSError` rejects the
       promise with the error's `localizedDescription` when it is set, and
       otherwise resolves with the value, no longer optional, as Swift
       returns it. An `NSError` that is not bound gets a stub declaring
       `localizedDescription`, so every such form binds with no flag.
     - A promise of an Objective-C object holds it in a box of its family,
       `HANDLE_BOX_OBJC`, beside GObject's, through `native::handle_box`.
       Before, a promise refused any counted handle that was not a
       GObject's.
     - `macos-blocks` runs the throwing shape with the handler called on a
       background thread. It resolves with an object on the main thread, and
       rejects with a real `NSError`'s description, on both backends.
     - A handler given several values is Swift's tuple, `async -> (A, B)`,
       so `Promise<[A, B]>`. `macos-blocks` settles one with two objects
       from a background thread, on both backends. A handler's values cross
       as the objects they are, as a block's do, so a string is an
       `NSString` there.
     - An awaited operation keeps the program alive, as node keeps it
       alive for an fs request. The wrapper calls `nts_pending_begin()`
       (`c:pending`) before the message, since Cocoa may call a handler at
       once, inside it, and `nts_pending_end()` first thing in the handler.
       `macos-blocks` runs a console program with no run loop that awaits a
       completion arriving 100 ms later from another thread, on both
       backends. The control drops the bracket, and that program ends first.
     - A block type a header names by a typedef, such as
       `NSTableViewDiffableDataSourceCellProvider`, is read from what the
       typedef spells, so the diffable data sources bind with a trailing
       closure.
     - A writable block property, such as `completionBlock` or a diffable
       data source's `rowViewProvider`, is its setter alone, taking a closure
       (`set completionBlock(value: (() => void) | null)`). A closure the
       program set is not read back as a function. `macos-blocks` sets an
       operation's `completionBlock`, which Foundation calls on a thread of
       its own and which is carried home, on both backends. Setting `null` is
       refused by name for now.
     - A block returning an object hands it back at +0, as ARC's caller
       expects. Under reference counting the adapter autoreleases the
       closure's count. `macos-blocks` watches such an object go once its
       caller lets go.
     - A class method's form is a static, as Swift's `class func` is:
       `await NSAnimationContext.runAnimationGroup((context) => ...)`. Its
       wrapper sends to the class, which it names. `macos-window` awaits
       one before the loop starts, and it prints `animated 0` on both
       backends.
     - That wrapper passes its own closure parameter on to the block, so a
       closure reached C through a value of a bare function type for the
       first time. The bridge called the type's `call` by name, which is a
       stub, and the C did not compile. Such a bridge now dispatches
       through the lent closure's own table, as any call through a function
       value does, in both backends. A C-callback test sends two different
       closures through one parameter, and it fails without the fix.
     - A handler the platform calls off the main thread is carried to it
       (below), so a completion on a background queue settles the promise
       on the owning thread, which is what Swift's `@MainActor` resumption
       amounts to.
   - **Blocks called off the owning thread are carried to it (2026-09-25).**
     A completion handler is usually called, and then released, on the
     queue the work ran on. The closure's count and heap belong to the
     thread that made it.
     - The invoke adapter tests the thread. Off it, the adapter packs its
       arguments and the host (`nts_block_carry`) copies them, holds a count
       of each object and of the block, and posts a task
       (`nts_post_from_any_thread`) that calls the closure on the owning
       thread and gives it all back. Dispose off that thread posts the
       closure's give-back (`nts_block_unlend`).
     - Both backends. `macos-blocks` calls a held block on a pthread with
       an object and an `int` and releases it there. The closure runs on
       the main thread with those values, and its captures are gone
       afterwards. Before this, the LLVM build of the same arm stopped with
       "a callback entered compiled code from a thread this environment
       does not own".
     - Still refused by name: a copy made off the thread, and a call off it
       to a block that returns a value or is given a pointer (`BOOL *stop`),
       whose caller is waiting or owns the memory only for the call.
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
       and `super` calls.
   - **Whole frameworks, measured (2026-09-25).** S4 left open whether a
     binding should be a class list or a whole framework. All of AppKit's
     306 classes generate in 2.35 s, as 16,004 lines (725 KB). A program
     importing one class typechecks against them in 3.65 s cold and 0.07 s
     warm, against 0.44 s cold for `macos-window`'s eight classes. So a
     whole framework is affordable.
     - It did not typecheck at first: 33 subclasses conflicted with their
       bases. Clang's printed type drops `_Nullable` behind an availability
       macro (`API_UNAVAILABLE(watchos) __kindof NSTextElement *`), so a
       base read as non-null where its subclass did not.
     - Swift's declaration is now the nullability's truth for a property
       and a method's result: `T?` is nullable, and `T!` (a
       `null_resettable` property) reads non-null and is written nullable.
       With that, the whole of AppKit typechecks.
     - Next: generate the binding a program's `objc:` import names, into
       the build cache, rather than a class list checked into each fixture.
   - **S6, overrides landed (2026-09-25).** `class Canvas extends NSView {
     draw(dirtyRect) {...} }` is Swift's `override func draw(_:)`.
     - An override takes the selector of the method it overrides, from the
       superclass's binding (`drawRect:`). Swift's naming rule would give
       `draw:`, and `value(forKey:)` would get `value:` for `valueForKey:`.
     - A method the runtime passes a record by value (`NSRect`, `NSPoint`)
       takes it as C does. The LLVM entry point receives it by the
       platform's convention, from the same `aggregate::plan` a call uses:
       a `byval` pointer on System V, the parts stored into memory from
       registers, or an HFA stored whole. The method's type encoding spells
       the record as clang does (`{CGRect={CGPoint=dd}{CGSize=dd}}`).
     - `macos-window`'s `Canvas` gets `hitTest:` from AppKit synchronously
       (a point, in two registers) and `drawRect:` sent with a known
       rectangle (in memory), on both backends. With the override rule
       disabled, `drawn 40x30` reads `0x0`. AppKit's own draws are not the
       check: since macOS 14 they may pass a rect larger than the bounds.
     - **Property overrides (Swift's `override var isFlipped: Bool`).**
       `bind-objc` declares a property as the accessors an Objective-C
       property is: `get title(): string` and `set title(value: string)`.
       TypeScript refuses an accessor that overrides a field (TS2611), and
       lets one override an accessor. So `get isFlipped() { return true }` on
       a subclass is the getter AppKit sends, and it registers under the
       overridden property's getter selector, or its setter's. A read or
       write of such an accessor from TypeScript calls the compiled accessor
       directly, as a method of the class is called. `macos-window`'s canvas
       answers `isFlipped` true when asked through `objc_msgSend`, and a
       plain view answers false. Schema 29: the frontend reads native tags on
       accessors.
     - `super.m(args)` in such a method is `[super m:args]`: the superclass's
       method, sent through `objc_msgSendSuper` from the superclass of the
       program's class, since the method is the runtime's and not a function
       of the program's to call. `Canvas.hitTest` returns
       `super.hitTest(point)`, and the content view's hit test answers the
       canvas, on both backends.
     - A super message returning a record by value goes through
       `objc_msgSendSuper_stret` on x86_64 when the record comes back in
       memory, and through `objc_msgSendSuper` otherwise and on arm64.
       `Canvas.scannedWidth` sends `super.centerScanRect(_:)` and answers what
       an ordinary send of it answers, 41 for a width of 40.6, on both
       backends.
     - A method whose Swift form takes labels, `mouseDown(labels: { with:
       NSEvent })` for Swift's `override func mouseDown(with:)`, is
       `mouseDown:` taking the event. The IMP takes each label as its own
       argument, and the method makes the labels object its body reads. A
       call the program writes passes a literal's properties, never built.
       The canvas's `mouseDown` sees an event's `data1` sent from C and
       called from TypeScript, on both backends.
     - A method returning a record by value, Swift's `override var
       intrinsicContentSize: NSSize`, writes it through an address its entry
       point passes last, so its `return` copies the record. The entry point
       returns it as the platform does: in registers, or through the `sret`
       pointer on x86_64. The canvas answers `intrinsicContentSize` and
       `alignmentRect(forFrame:)` (labels in, 32 bytes out, `super`'s moved
       right) to sends from C, on both backends.
     - An optional chain as a statement (`window.contentView?.hitTest(p);`)
       compiles. Its value, `T | null | undefined`, has no representation,
       and nothing reads it, so each absent link jumps past the rest.
   - **S6, fields landed (2026-09-25).** `class Tally extends NSObject {
     count = 0; names: string[] = [] }` is Swift's stored properties.
     - The instance is the runtime's object, so the fields live in an
       object of their own. Its type sits in its own synthetic band
       (`SYNTHETIC_OBJC_STATES`), not the class's id, which already
       answers "a handle". That object is held in one ivar the host adds
       (`nts_objc_register_class`'s `make_state`).
     - The host adds an `init` that runs the superclass's and then the
       fields' initialisers (`{Class}#state`), and a `dealloc` that gives
       the fields back and then runs the superclass's. An instance that
       came in another way (decoded, another initialiser) gets its fields on
       first use.
     - `recv.x` is `member_of`'s arm for this receiver kind
       (`program_objc_instance_place`): `nts_objc_state(recv)`, which lends
       the object as `own.rs`'s `RUNTIME_LENDS_A_SLOT` says, then the field.
     - Refused by name: an initialiser that could run code (a call, a
       `new`, a member read, `this`), since it runs inside `init` before
       the ivar holds anything. Also refused: a constructor, and a static
       member.
     - `macos-classes` checks the values against the Objective-C oracle, the
       instance deallocated, and the program's live objects back where they
       were (the array the fields held included). Without the release in
       `dealloc` it prints `held`.
     - A closure in a field that captures `this` is a cycle the collector
       cannot see through the foreign object, as it is in Swift. Nothing
       breaks it.
     - **A subclass of a class with fields (2026-09-25).** `class Scored
       extends Tally { bonus = 5 }` crashed at `new`. The host's `init`
       sent to the instance's own superclass, which for a subclass was the
       same `init` again, until the stack ran out. A field `Tally`
       declares, read through a `Scored`, was also refused.
       - Now one state object per instance holds the fields of every class
         of the program's in its chain, base first, as a class of the
         program's lays out its fields. A field is at one index whichever
         class the instance is, so `Tally`'s methods read a `Scored`'s.
       - The first of the chain's classes with fields owns the one ivar. A
         subclass registered below it shares that ivar, and the `init` and
         `dealloc` added to the root send to the root's superclass.
       - A class with no fields of its own below one that has them
         (`Plain`) makes its base's state.
       - A method of the base called on a subclass's instance passes the
         instance as the base's handle, which the verifier had rejected.
       - `macos-classes` checks both, and the instance deallocated, against
         the oracle on both backends. The old compiler refuses the arm.
   - **S6, constructors landed (2026-09-25).** `class Ledger extends
     NSObject { constructor(owner: string, opening: number) { super(); ... } }`
     is Swift's `init(owner:opening:)`.
     - The constructor lowers to `{Class}#new`, which `new` calls. Its
       `super(...)` is where the instance is made: `+alloc` sent to the
       program's class, then the `init...` of the superclass constructor the
       checker resolved. `this` is that object from there on.
     - Its fields are made at once, whichever `init` it was.
     - `macos-classes` sets a field from an argument and sends the new
       instance its own message, against the same class in Objective-C, on
       both backends. The instance is released at its last use.
     - A parameter property, `constructor(readonly owner: string, ...)`, is
       a field stored once `super(...)` has made the instance.
     - Refused by name: a constructor that does not open with its
       `super(...)`, a `super(...)` into a factory, and a `new` of a class
       that inherits a program class's constructor.
     - An instance Objective-C makes itself (`[Ledger new]`, a nib) runs its
       superclass's `init` and not the constructor.
     - A `static` member (Swift's `static var`, `static func`) is the
       program's alone: a global and a function, as any class's is, and not a
       class method the runtime is told of. `Ledger` counts the ledgers its
       constructor opens.
   - **`Map<string, NSObject>`, Swift's `[String: NSObject]` (2026-09-25).**
     A map's value may be a counted foreign object, held in a box of its
     family (`handle_box`, as a promise holds one).
     - `set` boxes the value, and `get`, `for...of` and `forEach` read the
       box's handle, a missing key reading as `undefined`. The box holds the
       object's count and gives it back when the entry is overwritten or
       deleted, or when the map goes.
     - A key may not be a handle: a box has an identity of its own, not the
       object's.
     - A pointer typed `NSObject | undefined` compares with `undefined` as
       its null.
     - Cost: one box per entry, a 24-byte header and an 8-byte handle, so 32
       bytes and one allocation beside the entry's two 16-byte values. This is
       computed from the structs, not measured. The JVM lane stores the
       reference and has no box.
     - `macos-classes` checks set, overwrite-with-itself, delete, iteration
       and the map's own death against an `NSMutableDictionary` under ARC, on
       both backends, and the NoGc control sees exactly the two lifetime
       lines differ.
     - A message's `NSDictionary<NSString *, V>` parameter is this map:
       bind-objc writes `Map<string, V>` (keys through their typedef, so
       `NSAttributedStringKey` is `string`), and the call copies it into an
       `NSDictionary` made by the CF host (`nts_nsdictionary_of_objects` /
       `_of_strings`, +1). 46 AppKit members bind this way.
       `NSAttributedString(string:attributes:)` reads back an `NSNumber` and
       a string value, against clang, on both backends.
     - A dictionary a message or a property answers is a map too. The CF
       host fills a keys array and a values array in one pass
       (`nts_dictionary_fill_from_nsdictionary`), and the lowering sets each
       pair into a new map, boxing each object as any map does; nil is `null`.
       `attributes(at:effectiveRange:)` and `ProcessInfo`'s `environment`
       (`[String: String]`) read back against clang. Collection skips across
       AppKit fall to 34, nearly all `NSSet`.
   - **An application, end to end (2026-09-25).** `macos-notes` is a notes
     app as Swift writes one: a window with a text field, an Add button and
     an `NSTableView`, and a controller that is the button's target and the
     table's data source.
     - The controller takes the notes and the views in its constructor, as
       parameter properties.
     - It is laid out with Auto Layout anchors, as Swift writes it:
       `field.leadingAnchor.constraint({ equalTo: content.leadingAnchor,
       constant: 20 }).isActive = true`. Each overload is chosen by its
       labels, and the frames Auto Layout computes are reported.
     - Notes are read with a throwing `NSString(contentsOfFile:encoding:)`
       and written back with `write(toFile:atomically:encoding:)`.
     - It drives itself and quits, and runs four times on one file: C twice,
       then LLVM, then C under reference counting, each finding what the last
       saved.
     - It found that a throwing constructor's `+alloc` inherited the
       constructor's error slot. A declaration's `@ntsThrows` is now its own
       selector's alone.
   - **S6, protocols landed (2026-09-25).** `class Elements extends NSObject
     implements XMLParserDelegate` is Swift's `class Elements: NSObject,
     XMLParserDelegate`.
     - A method named in an implemented `objc:` interface answers the
       selector the protocol declares (`@ntsSelector`). So
       `parserDidStartElement` is `parser:didStartElement:namespaceURI:qualifiedName:attributes:`,
       which no naming rule could give it.
     - The class adopts the protocol at registration (`nts_objc_adopt`, which
       calls `class_addProtocol`), under the Objective-C name that
       `@ntsProtocol` gives the interface.
     - `nts bind-objc --protocol NSWindowDelegate` writes the interface.
       - Each method is required, or `?` where Swift's graph says
         `optionalRequirementOf`.
       - Every argument is positional. An object, a string included, crosses
         as itself, as at a block.
       - A method keeps its Swift base name when that name is unique in the
         protocol. Delegate protocols share one (`parser(_:...)` twenty times
         over), so the rest take the first label (`parserFoundCharacters`),
         or the selector when that collides with a name Swift gave.
     - `macos-classes` parses XML through a delegate and asserts the
       conformance against the Objective-C oracle. The control, with
       `class_addProtocol` stubbed out, fails on that line.
     - `macos-window`'s controller now implements the generated
       `NSWindowDelegate`.
     - Not yet: property requirements and class-side requirements. Both are
       listed as not bound, with the reason.
     - **Not GTK's `__c_implements`.** The two answer different questions.
       `@ntsProtocol` is an attribute naming a runtime protocol: which
       selectors a method is sent under, and what `class_addProtocol` adopts.
       `__c_implements` is a type-level marker: which interface handle a
       GObject handle is assignable to. An Objective-C protocol needs no
       assignability, because a parameter typed `id<P>` is spelled as the
       object it is (`NSObject`), and TypeScript's structural check does the
       rest. If one program ever wants both, they meet at the `implements`
       clause and at nothing else.
   - **Application bundles (2026-09-25).** A `kind: "application"` product
     for macOS, which is what `app.macos(...)` makes, is packaged as
     `<name>.app`, with `Info.plist` built from the product's `id` and
     `minimumVersion`. It is refused without an `id`, as the APK is.
     `macos-window` runs its `windowApp.app` on the VM (`run.sh` now takes a
     bundle). The program reads `Bundle.main.bundleIdentifier` back: the
     bundle prints `dev.nts.examples.window` where the bare executable prints
     `none`.
   - **Every LLVM arm is `nts build`'s (2026-09-25).** Each macOS fixture's
     LLVM arm was `emit-llvm`, clang and a hand link against the C build's
     units. Now each fixture declares a second product for the LLVM backend
     (`classesLlvm`, `windowLlvm`, ...), which `nts build` compiles and links
     with the same runtime and host units (the Windows lane's 8daaa920).
     - Each arm asserts that its program was compiled from `program.ll` and
       that `program.c`, which the C emission also writes, never was. So a
       build that fell back to C cannot pass as LLVM's.
     - **arm64 too (2026-09-25).** Each fixture's LLVM product also builds
       for `aarch64`, and its `build.sh` asserts an arm64 Mach-O compiled from
       `program.ll`. These are built and linked, not run, since the lane's Mac
       is x86_64.
       - Records crossing a call follow AAPCS64 (`aggregate::aapcs64`). A
         homogeneous aggregate of doubles (all of AppKit's geometry) goes in
         SIMD registers, 8 or 16 bytes of integers in general ones, and a
         result over 16 bytes through `x8`. An arm64 send never uses
         `_stret`.
       - `by_value.rs` compares the declarations with clang's for
         `arm64-apple-macos13`.
       - `examples/interop/arm64-records` *runs* them. The same program is
         built by both backends for arm64 Linux, which spells every admitted
         shape as Apple does, and run under qemu. The LLVM build must print
         what the C build prints. Spelling the four doubles as integers
         prints denormals.
       - Refused by name: a `float` aggregate as an argument (Apple and Linux
         align it differently on the stack), sizes whose integer load or
         store would run past the record, and arguments over 16 bytes (a
         pointer to a caller's copy, not built yet).
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
     | field (`this.count++` on an `NSObject` subclass) | 1.5 ns | 3.0 ns | 0.50 |
     | plain-field (the same on a plain class) | 0.4 ns | 2.8 ns | 0.14 |
     | override (`shape.sides()`, a `Square` seen as a `Shape`) | 0.8 ns | 0.9 ns | 0.89 |

     - The two field rows (2026-09-25) keep Swift's `bump` out of line
       (`@inline(never)`); `swiftc -O` otherwise folds the loop to nothing.
       Ours is a direct call, which clang inlines.
     - The override row (2026-09-25) is a call to a method that a subclass
       the program writes overrides. Swift's is a vtable call through an
       object from an `@inline(never)` function. Ours compares
       `object_getClass` with each class the program writes below the
       method's, then calls the matching implementation directly. Only a
       class the runtime made asks `isKindOfClass:`: key-value observing's
       `NSKVONotifying_` subclass is one, and macos-classes' `observed` line
       checks it. The first version asked `isKindOfClass:` every time, at
       3.6 ns, 4x Swift.
     - What the Objective-C field costs is the difference between our two
       rows, **about 1.1 ns an access**. That is one `nts_objc_state` call
       (the class looked up from `self`, the last one remembered) where a
       plain field is a load. It is the baseline for inlining the load,
       which is a load at the ivar's offset and a null test.

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
   - **S8, Core Graphics as Swift imports it (2026-09-25).**
     `context.fill(rect)`, `context.setFillColor(CGColor({ red: 1, green: 0,
     blue: 0, alpha: 1 }))`, `context.width`: the C functions Swift makes
     members of its Core Foundation classes.
     - Swift's symbol graph puts each C function, by its clang USR
       (`c:@F@CGContextFillRect`), under the class Swift makes of its
       `Ref` (`c:@T@CGContextRef`), with labels from the SDK's API notes.
       `bind-objc --class CGContext` binds such a class (`bind_objc/cf.rs`).
       Its `self` is the one parameter of the class's own type, since the
       importer requires one, so it is read from the types. A function with
       two such parameters is skipped with that reason.
     - A class is `ObjcClass<Tag>`, a handle the program counts. A Core
       Foundation object is an Objective-C object on Apple's platforms, and
       `objc_retain`/`objc_release` count it. Its methods are an interface
       of C functions with `this` (`CGContextOwnMethods`), the shape every
       C handle has. A property is read through its function (`@ntsGet`),
       now excluded from the "properties are messages" rule. Its
       initializers are a function of its name, `CGColor({ red, ... })`,
       which is Swift's `CGColor(red:green:blue:alpha:)`.
     - Core Foundation's create rule: a function named `Create` or `Copy`
       returns `Owned<T>`. Swift's optionality decides a result's `| null`,
       since the API notes tighten the header (`CGColorSpaceCreateDeviceRGB`
       is not optional). `void *` is `Ptr<unknown>`, Swift's
       `UnsafeMutableRawPointer`. `--function` binds a free function.
     - A module of C frameworks alone names their headers (`@ntsHeader
       <CoreGraphics/CoreGraphics.h>`), so the native witness compares every
       prototype with the SDK's.
     - AppKit and Core Graphics in one module: `macos-window` binds
       `NSGraphicsContext` and `CGContext` together. Its canvas's
       `draw(_:)` fills through `NSGraphicsContext.current?.cgContext`, and
       `cacheDisplay(in:to:)` has AppKit draw it offscreen, as on screen.
       The pixel reads back red through `NSBitmapImageRep.colorAt(x:y:)`,
       on both backends. Two things had to change for that:
       - A module binding Objective-C classes names no header, so the
         native witness now forward-declares a tagged record a prototype
         passes (`struct CGRect;`).
       - The chain's type is `CGContext | undefined`, a handle with
         `undefined` beside it. It is now represented as the pointer, its
         null standing for `undefined`, as `H | null`'s stands for `null`.
         With both absences it is still refused.
     - What Swift hides behind its own overlay is not bound:
       `CGContextMoveToPoint` is `SwiftPrivate`, and `move(to:)` is Swift
       code with an `s:` USR and no C symbol.
     - `macos-draw` draws into a bitmap context the program owns, with a
       rectangle as a colour, as components, as fields in a variable, an
       ellipse, and a cleared pixel. It compares every pixel with the same
       drawing in C, on both backends. The colours are released (an
       Objective-C weak reference goes nil), and under NoGc that line alone
       differs.
   - **iOS, on the simulator (2026-09-25).** A UIKit application written in
     TypeScript runs on the iOS simulator of the lane's Mac, from both
     backends: `examples/interop/ios-hello`.
     - `nts build` refused every iOS target ("needs a bundle, signing and a
       simulator"). An `x86_64` iOS target can only be the simulator, on an
       Intel Mac, and needs no signing. `ios_toolchain` builds it with the
       simulator's triple (`x86_64-apple-ios17.0-simulator`) against its SDK
       (`sync-sdk.sh iphonesimulator`) and a libuv built for it
       (`build-libuv.sh x86_64-ios-simulator`). The binary's
       `LC_BUILD_VERSION` names `iossimulator`. `aarch64` is a device, or
       Apple silicon's simulator, and is refused as needing signing.
     - An `application` for iOS is a flat bundle (`<name>.app/<name>`,
       `Info.plist` with `LSRequiresIPhoneOS`, a launch screen, and the
       `CFBundleVersion` the simulator requires), installed and launched by
       `tooling/apple/run-ios.sh` through `simctl`. The application's console
       is the run's output.
     - The CoreFoundation host serves UIKit's main run loop, as it serves
       AppKit's, so timers and promises run inside `UIApplicationMain`.
     - bind-objc knows the platform from the target. Availability is read for
       `iOS` rather than `macOS`, and an iOS SDK's graphs live under its
       canonical name (`symbolgraph/iphonesimulator26.5`), which
       `NTS_APPLE_PLATFORM=iphonesimulator symbolgraph.sh` writes.
     - An `async` form's arguments are shaped as the method it calls takes
       them. A block before the completion handler, such as
       `animateKeyframes`'s `animations`, stays among the labels rather than
       becoming a trailing closure. UIKit's `UIView` found this.
     - `ios-hello`: an application delegate over `UIResponder` receives
       `application(_:didFinishLaunchingWithOptions:)`, builds a window, a
       view controller, a label and a button, and the button's action,
       `selector(Controller, "pressed")`, reaches the program's controller
       through `sendActions(for:)`. A timer from UIKit's run loop ends it. A
       screenshot of the simulator shows the blue view and the white label.
     - **Each iOS fixture has a Swift twin (2026-09-25).**
       `reference/hello.swift` and `reference/list.swift` are built by
       `swiftc` for the simulator, bundled from the TypeScript product's
       `Info.plist` under their own identifiers, and diffed with it.
     - **`ios-list` (2026-09-25):** a `UITableView` in a navigation
       controller, backed by a data source the program writes. Building it
       found three gaps:
       - A method no message could carry (`append(item: string)`) is now
         Swift's method without `@objc`: lowered, and not registered.
       - `a?.b?.c` typed `c`'s receiver as `B | null | undefined`. It is now
         the present type (`present_part`).
       - **A defect, and not a gap.** A call to a program class's method
         went straight to the static type's method, so an override in a
         subclass was never reached (`const x: A = new B(); x.f()` ran
         `A#f`). Dispatch compares `object_getClass` with each of the
         program's classes below the method's, then calls the matching
         method directly. `isKindOfClass:` covers a class the runtime made,
         which key-value observing's `NSKVONotifying_` subclass is (the
         `observed` line in macos-classes). It costs 0.8 ns against Swift's
         0.9 (the `override` bench row).
     - **A protocol as a value's type (2026-09-25).** bind-objc spells
       `id<P>` as `P` where it declares `P`, and each protocol interface
       `extends NSObject`. A value of one is an Objective-C interface
       handle over `NSObject`'s chain. Its methods are messages, and
       `delegate?.m?.(...)` asks `respondsToSelector:` first. Before this, a
       call through the optional-method path tested the object against the
       program's classes and was dropped silently.
     - **`UIApplicationMain` from the binding (2026-09-26).** `--function
       UIApplicationMain`, with `exit` from `c:stdlib`. A C function's
       `NSString *` is a `BridgedString` (`objc:types`), the converse of
       `CString`: a plain `string` is a `char *` outside a message, and
       binding one as `string` handed UIKit a C string for a class name,
       which printed nothing and refused nothing. A `BridgedString` result is
       read back as an `NSString`. Arguments and results are checked by
       macos-classes' `class-names` line: a literal, a variable, a
       concatenation, and nil.
     - Still C in each iOS fixture: `report`, the test's output.
       `console.log` is the node lane's runtime, which a native application
       does not link.
     - Not yet: an array of `ClassObject`, an uncounted C pointer, is
       unrepresentable.
   - **Swift's one `nil` (2026-09-25).** `window.contentView?.superview`
     is `NSView | null | undefined`: a nullable property down an optional
     chain. It is now the pointer, its null standing for both absences, as
     Swift's `NSView?` has one `nil`.
     - `== null`, `??`, `?.` and a condition ask *whether* it is absent,
       and are exact.
     - Only a strict comparison with one absence could ask which, and it is
       refused by name ("compare with `== null`").
     - `macos-window` reads the window's frame view this way, on both
       backends. A C test lowers the loose forms and is refused the strict
       one.
   - **All of Foundation typechecks (2026-09-25).** 244 classes, bound
     whole, now typecheck and lower with no refusal. So does all of AppKit.
     Two rules made the difference:
     - A subclass that redeclares its base's selector at other types keeps
       the base's overload beside its own. `DistributedNotificationCenter`'s
       `addObserver:selector:name:object:` takes a `String?` object where
       `NotificationCenter`'s takes an `NSObject?`, and TypeScript holds a
       subclass's overloads to its base's. Two overloads that differ only in
       a parameter's name (`cView`, `clipView`) are one (`unnamed`).
     - A property Swift names as an ancestor's *other* property is left to
       the ancestor: `NSScriptClassDescription`'s `superclass` is read with
       `superclassDescription`, and `NSObject`'s with `superclass`. An
       override is read by the same getter; this is not (`Reading::getters`).
   - **A closure in a field, called (2026-09-25).** `this.started()`, where
     `started` is a field of a class written over an Objective-C class: read
     from the object the ivar holds and called through the closure's slot.
     It was refused as a method of an opaque pointer. `macos-notes`'
     application delegate is handed what to start once the application
     has launched, and starts the typing timer from
     `applicationDidFinishLaunching`, in TypeScript and in Swift alike. The
     order `launched`, then the notes, is by construction: the first version
     raced the launch against a 50 ms timer and lost once.
   - **Swift's `Set<T>` (2026-09-25).** `NSSet<T *> *` crosses as
     `Set<T>` both ways: a set of objects, or of strings.
     - A set of Objective-C objects compares as Swift's and `NSSet` do,
       with `-hash` and `-isEqual:`, not by identity. Two equal
       `NSIndexPath`s are one element. The runtime has a key kind for it,
       `NTS_KEY_OBJC`: the key is the object's box, and its hash and
       equality are hooks the CF host installs at load. Lowering allows a
       `Set` of counted Objective-C handles and picks that kind for it.
       Boxing on the way in and unboxing on the way out are the map-value
       arms.
     - A `Set` passed is an `NSSet` made of it (`nts_nsset_of_*`, +1). One
       returned is read through its `allObjects`, as an array is, then
       added, so the elements are counted as an array's are.
     - The 30 `NSSet` skips across AppKit are bound: the collection view's
       index paths, touches, identifiers. The whole binding still
       typechecks and lowers.
     - `macos-classes` makes an `NSSet` with an equal string twice, reads
       back a grown one, finds an equal string in it, passes it back to
       `isSubsetOfSet:`, and does the same with `Set<String>`. It agrees
       with the Objective-C oracle on both backends. A bind-objc test spells
       both.
   - **The notes app against Swift (2026-09-25).** `macos-notes` has
     `reference/notes.swift`, the same application in Swift, line for line:
     the window, the anchors, the data source, `#selector(Notes.add(_:))`
     where the TypeScript says `selector(Notes, "add")`, and the timer that
     types three notes. `swiftc` builds it on the Mac. Its first run prints
     what the TypeScript program's first run prints, and the fixture diffs
     the two. This is S4's Swift oracle, on the fixture that is an
     application. `macos-window`'s job and timeout lines are JavaScript's
     event loop, which Swift has no twin of.
   - **Swift's `#selector` (2026-09-25).** `button.action =
     selector(Notes, "add")`, from `objc:runtime`. It used to be
     `sel_registerName("add:")`, which is where a missing colon hid.
     - The checker holds the name to the class's methods (`MethodOf`), so a
       property or a misspelling is a type error.
     - The compiler answers the selector the method was registered under
       (`program_method_selector`, which `lower_objc_method` now uses too): a
       protocol's, an override's (`drawRect:`), or Swift's `@objc` rule. A
       binding's class answers its `@ntsSelector`, found up the chain.
     - The value is `ObjcSelector`, read through the cached lookup a send to
       it uses, in both backends.
     - `macos-window` and `macos-notes` set their buttons' actions this way.
       A C codegen test covers the three rules and an imported class.
   - **A record written as its fields (2026-09-25).** Swift writes
     `NSRect(x: 200, y: 200, width: 320, height: 200)`. Here it is
     `contentRect: { origin: { x: 200, y: 200 }, size: { width: 320,
     height: 200 } }`, the C struct's own members. Every fixture used to
     hand-write a `setRect` helper over `local<CGRect>()`.
     - `c:types` has `Fields<T>`, and bind-objc writes a by-value record
       parameter, and a record property's setter, as `ByValue<T> |
       Fields<T>`. The schema reads that union as the `ByValue<T>` it is to
       C (`schema::stored`), so nothing else about the parameter changes.
     - A literal is storage in the caller's frame, a zeroed `NativeLocal`
       with a local's rules, filled field by field in the order written,
       which is when JavaScript evaluates them. A nested record is filled in
       place, and a field left out is zero. Nothing is allocated: it is C's
       compound literal, for every lane's C records alike.
     - An object in a variable is read field by field at the call, as
       labels in a variable are. An accessor is refused by name, not
       written as zero.
     - A C-callback test covers the literal (full, partial, and the order
       its values are evaluated in) and the variable, on both backends and
       both providers, with no leak. The old compiler refuses the literal.
       `macos-window` and `macos-notes` write every rectangle and point
       passed to a message this way, `super` sends included. A rectangle a
       method returns is still `local<CGRect>()`, since a literal is not
       storage that outlives it.

5. **A4:** the idiomatic layer, Swift in both directions, an `.app`, and a
   benchmark against NativeScript and Swift.

6. **Decision needed: how a program gets its binding (measured
   2026-09-26).** Today each fixture runs `nts bind-objc` with a list of
   `--class` flags and commits the result. Swift's programmer writes
   `import AppKit` and gets every class. S4 left the choice to a
   measurement, and this is it: macos-window checked against its own
   class-list binding, then against every class AppKit's symbol graph
   declares.

   | binding | size | `nts bind-objc` | `nts check` | peak memory |
   |---|---|---|---|---|
   | class list (13 classes) | 191 KB | -- | 0.97 s | 177 MB |
   | all of AppKit (306 classes) | 768 KB | 3.1 s | 4.17 s | 326 MB |

   The whole-framework binding typechecks cleanly; the 8 errors that run
   reported were the program's own names from Foundation and CoreGraphics,
   which the AppKit-only list left out. So whole frameworks work, and they
   cost every check about 3.2 s and 150 MB for one framework of the three a
   window uses.

   The options:
   - **Whole frameworks, generated once per SDK into the build cache.** It is
     Swift's `import AppKit`, and costs about 4x on every check of every
     program, most of which name a dozen classes.
   - **Class lists in `nts.config`**, as the fixtures do now. It is cheap,
     but every class a program touches has to be named twice: in the config
     and in the import.
   - **Recommended: the list derived from the program.** `nts build` reads
     what the program imports from `objc:AppKit` (and the signatures those
     classes mention, as `mentioned` already does), and generates that
     binding into the build cache, keyed by the SDK and the name set. It is
     Swift's `import AppKit` for the programmer, at the class list's cost for
     the checker. No binding file is committed. Regeneration is a cache miss,
     not a diff. The generator's own tests keep the committed fixtures as
     their oracle.

   The third changes the workflow: bindings stop being files in the
   project. That is the user's call, and it is not built.

## Rules this lane keeps

These come from `native-lane-goal.md` and the GTK lane: two arms per claim, one
variable per arm, and assertions on the artifact rather than the status. Commits
use explicit paths and stage only this lane's hunks. Builds and tests run from a
worktree at HEAD plus only this lane's change (`~/.cache/nts/apple/wt`), because
the shared tree always holds someone's uncommitted work.

One rule is specific to Apple: **a result that did not run on a Mac says so.**
"Links" is not "runs", and an x86_64 run is not an arm64 run.
