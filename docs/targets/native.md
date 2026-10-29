# Native

Programs compiled to machine code through the C or LLVM backend: command-line
programs and libraries for Linux, macOS and Windows, how such a program calls
C, and how C calls it. For anyone building a native artifact or binding a C
library. The platform UI SDKs have pages of their own ([GTK](gtk.md),
[Apple](apple.md), [Windows](windows.md)), as does the
[Node addon](node-addon.md).

## Where it runs

| platform | architectures | how it is built | where it has run |
|---|---|---|---|
| Linux | x86-64 | this machine's clang, linked against libuv | gated |
| Linux | aarch64 | cross-built, statically against musl (`CC=tooling/linux/cc-musl.sh`) | under qemu, in the interop tests |
| macOS | x86-64, aarch64 | cross-built from Linux ([Apple](apple.md)) | x86-64 on a VM; arm64 never |
| Windows | x86-64, aarch64 | cross-built with zig's mingw ([Windows](windows.md)) | x86-64 on a VM; arm64 never |

The compiler itself runs on Linux. macOS on Apple silicon is to be its next
host, then native Windows, and WSL serves meanwhile ([Decisions](#decisions)).
An x86-64 build targets x86-64-v3 (AVX2, BMI2, FMA) and stops by name on an
older CPU; a target with `cpu: "baseline"` builds for every x86-64 CPU.

## Two backends, one runtime

- **C** (`nts emit-c`) writes C11 for clang. It is the readable one, and the
  oracle the LLVM backend's output is compared against.
- **LLVM** (`nts emit-llvm`) writes textual IR that `clang -x ir` compiles. The
  `nts` binary links no LLVM library, so no LLVM version is pinned into it
  (register [T-2](../open-questions.md#6-bindings-products-toolchains-dependencies)).
  It classifies records passed by value for System V, Win64 and AAPCS64.
- **LLVM is the frontier native backend, and C is held equally.** Both meet
  [the bar](../README.md#the-bar) on every row, and a row where LLVM is slower
  than C is a defect. The LLVM IR states to the optimizer everything nts
  proves (designed, not built): which accesses cannot alias, from the
  layouts (type-based alias metadata, alias scopes), that a fresh allocation
  aliases nothing, which integer operations cannot overflow (`nsw`, `nuw`),
  which address computations stay inside their object (`inbounds`), which
  pointers are non-null and dereferenceable, which functions cannot unwind
  and what memory they touch, the ranges of lengths and integers, and the CPU
  each function is built for. C can say only part of
  this, so LLVM is where nts can pass C.
- Both read one prepared program, emit the same symbols and ABI, and link the
  same runtime, so a program built by either links against the same C. A
  disagreement between the two is a backend bug by construction.
- **Memory:** `nts build` counts references, with a cycle collector behind
  them, unless told `--nogc`, which never frees and exists for testing. Before
  any count, escape analysis places objects that never leave a call in its
  frame ([memory](../foundations/memory.md)).

## The C runtime

`runtime/c` is the one runtime both backends link. Its sources are baked into
`nts` and written out beside each program:

- `nts_runtime.h` and `nts_runtime.c`: allocation and counting, the cycle
  collector, strings, arrays, tables, promises and the microtask queue, the
  uncaught-error path, and the helpers C interop calls;
- vendored zmij (number to text) and ffc (text to number), and the Unicode
  case tables, emitted only into programs that use them
  ([numbers](../foundations/numbers.md), [strings](../foundations/strings.md),
  [Unicode](../foundations/unicode.md));
- one **host** per kind of event loop, each an implementation of `NtsHost`
  ([async](../language/async.md#the-event-loop-on-each-target)):

| host | file | used by |
|---|---|---|
| libuv | `nts_uv_host.c` | executables |
| GLib | `nts_glib_host.c` | GTK programs |
| CoreFoundation | `nts_cf_host.c` | Apple programs that send Objective-C messages |
| Win32 | `nts_win_host.c` | every Windows executable |
| test | `nts_test_host.c` | `nts check`: virtual time, no I/O |

A library has no loop. A C program that embeds one and wants its timers or I/O
installs a host of its own (`nts_host_install`).

## Products

| product | constructor | artifact |
|---|---|---|
| executable | `app.cli`, `app.linux`, or `app({ kind: "executable", targets })` | the program, with its host |
| shared library | `library.native` | `.so`, `.dylib`, or `.dll` with its import `.lib` |
| static library | `library.staticNative` | `.a`, holding the runtime and the program |
| XCFramework | `library.xcframework` | refused by name: build `shared-library` slices and assemble them |

- A library's surface is what its `entry` module exports, and nothing else:
  the program is rooted there, and a shared library's link hides every other
  symbol.
- A library initializes itself: module evaluation runs from a load-time
  constructor (`nts_auto_init`) before any consumer code. An executable runs
  it from its `main`.
- `soname` overrides the shared library's derived name.

Every field is in the [`nts.config.ts` reference](../reference/nts-config.md).

## Calling C

### Declaring a C library

A C library is an ambient module named `c:<name>`. Its members enter scope
only through imports, and each declaration is the authored ABI: the compiler
derives the C prototype from it and never from a call site.

```ts
// types/counter.d.ts
/** @ntsHeader "counter.h" */
declare module "c:counter" {
  import type { Opaque } from "c:types";
  import type { c_int } from "@nts/scalars";

  export type Counter = Opaque<"Counter">;           // struct Counter *
  export function counter_new(initial: c_int): Counter | null;
  export function counter_bump(counter: Counter, by: c_int): c_int;
  export function counter_destroy(counter: Counter): void;
}
```

```ts
import { counter_new, counter_bump, counter_destroy } from "c:counter";

const counter = counter_new(1);
if (counter !== null) {
  counter_bump(counter, 2);
  counter_destroy(counter);
}
```

JSDoc tags on a module or a declaration say what its types cannot:

| tag | says |
|---|---|
| `@ntsHeader h` | the header that declares the module's members: included by the program, checked by the witness |
| `@ntsLibrary name` | the library a function needs (`-l`): a program links what it calls and nothing more |
| `@ntsPackage pkg` | the pkg-config packages a module's headers and symbols come from |
| `@ntsNoEscape p` | the callee keeps nothing of `p` past the call |
| `@ntsDefault p=v` | what the compiler passes for an optional parameter the caller leaves out |
| `@ntsThrows p converter` | a failure reported through an out parameter is thrown as an `Error` when the caller leaves the slot out |
| `@ntsConstant v` | an exported `const` is a constant, folded where it is read; nothing is linked |
| `@ntsAbi managed` | an nts host bridge, with the managed convention, not a C ABI |

`runtime/native/libc.d.ts` ships with the compiler: hand-written declarations
of a libc subset (`c:stdlib`, `c:math`, `c:stdint`, `c:stddef`, `c:stdbool`)
and the binding vocabulary (`c:types`, `c:memory`, `c:pending`). A project adds
it to its tsconfig's `include`; it is not loaded automatically. Third-party
libraries are not shipped: a project binds them, by hand or with `nts bind-c`.

### Numbers

The numbers in a declaration are kinds from `@nts/scalars`
(`runtime/native/scalars.d.ts`): `Int8` to `Uint32`, `BigInt64`, `BigUint64`,
`Float32` and `Float64`, and C's own `c_char`, `c_int`, `c_uint`, `c_long`,
`c_size_t`, `c_ptrdiff_t` and `c_uintptr_t`, as wide as the target makes them.
A kind is a `number` (a `bigint` where every bit of 64 is wanted) with an
optional label, so a plain number is written where one is wanted, with no cast,
and a result needs none.

- A value stored into a kind (an argument to C, a field, a local, a return)
  must be proven one of the kind's values, or the build stops (NTS5001).
  `n | 0` is proven an `int`; an `as` is accepted only where nts proves it.
- `AsNumber<c_size_t>` hands a 64-bit integer over as a number, exactly: a
  value past 2^53 is a `RangeError`, never rounded.
- `c_long` is 64 bits on Linux and macOS and 32 on Windows. A build for several
  targets takes a value only where it fits on every one.

### The binding vocabulary

`c:types` describes what a C prototype means, so the call can be lowered
exactly. Where a module names its header, the witness checks every
declaration written with these types against it.

| family | types | C |
|---|---|---|
| handles | `Opaque<Tag>`, `Class<Tag, Parent>`, `Const<H>`, `Erased<H>`, `Declared<T, D>`, `Typedef<T>` | a pointer to a struct the program cannot see into; a single-inheritance chain (`GtkButton` is a `GtkWidget`); `const`; `void *`; a factory declared as an ancestor; a typedef with no tag |
| records | `Struct<Fields, Tag>`, `Union`, `Packed<T>`, `CArray<T, N>`, `Bits<T, N>`, `Flexible<T>`, `Given<T>` | a struct or union laid out as C lays it out, inline arrays, bit-fields, a flexible array member, a WebIDL-style "given or not" member |
| pointers | `Ptr<T>`, `ConstPtr<T>`, `ByValue<T>`, `Fields<T>` | `T *`, `const T *`; a record passed by value, from storage or written as an object literal |
| callbacks | a function type; `Closure<F>`, `ScopedClosure<F>`, `OnceClosure<F>`, `ErasedClosure<F, N>` | a function pointer; a callback with a context that C keeps, uses during the call, or calls once; GLib's `GCallback` |
| text and arrays | `string`, `Utf16String`, `StringView`, `CStrings`, `CBytes`, `CElements`, `CHandles`, `Counted<A, L>` | `const char *` (UTF-8), `const uint16_t *`, a lent view of the string's own units, `char **`, a typed array's bytes or elements, an array of handles, an array with its length in a parameter of its own |
| values | `CEnum<E, B>`, `CBool<B>` | an enum or a boolean C holds in an integer |
| counted families | `GObjectClass`, `HostClass`, `Owned<T>`, `Consumed<T>`, `Boxed` | objects a host counts, and transfers of their references ([GTK](gtk.md), [Chromium](chromium.md)) |

`c:memory` holds the storage operations, which the compiler lowers itself:
`local<T>(count)` (zero-initialized storage in the frame), `sizeof<T>()`,
`addrOf(place)` (C's `&p->field`), `copy(destination, source)`,
`stringFrom(p)` and `bytesFrom(p, length)` (copy C's memory into a `string` or
a `Uint8Array`), `pointerBits(p)` and `unsafeDowncast`. `c:stdlib`'s
`malloc<T>(bytes)` and `free` are typed and manual.

```ts
import type { c_int } from "@nts/scalars";
import { poll, type PollFd } from "c:poll";
import { local } from "c:memory";

export function waitReadable(fd: c_int, timeoutMs: c_int): number {
  const request = local<PollFd>();     // struct pollfd, in this frame
  request.fd = fd;
  request.events = 1;                  // POLLIN
  return poll(request, 1n, timeoutMs); // poll's binding says @ntsNoEscape
}
```

- `p[i]` indexes elements, `p.field` reads and writes a member at its C width,
  and a member that is a record or an inline array reads as a pointer to it.
- Reads and writes through a raw pointer are the caller's obligation: nothing
  checks bounds, alignment or lifetime there.
- A variadic function's tail is a rest parameter whose type the binding
  states: `open(path: string, flags: c_int, ...rest: Uint32[])`. A binding
  that needs two shapes declares two names.

### Strings at the boundary

- A `string` parameter is `const char *`: NUL-terminated UTF-8, lent for the
  call and given back after. An all-ASCII one-byte string is lent in place;
  any other is converted. A lone surrogate becomes U+FFFD, and a U+0000 inside
  the string ends the process, naming the boundary.
- A `string` result is copied into a string the program owns. The C pointer is
  neither kept nor freed.
- `Utf16String` lends UTF-16, in place when the string is already two bytes a
  unit, and passes a lone surrogate unchanged. `StringView` lends the string's
  own units with their width and length, so text crosses exactly, U+0000
  included.

### Callbacks

- A function passed where a declaration writes a function type is a C function
  pointer: the compiler emits a bridge with the foreign signature that calls
  the compiled function. It must not capture, since a bare code pointer has no
  room for an environment.
- A capturing callback is a `Closure<F>` (C keeps it and releases it through
  the destroy function it is given), a `ScopedClosure<F>` (used only during the
  call, released after it) or a `OnceClosure<F>` (called exactly once, then
  released). The context and destroy parameters are in the C prototype, and
  neither the binding nor the caller writes them.
- A parameter without `@ntsNoEscape` may be kept by the callee, so frame
  storage cannot be passed there: `native local address escapes`.
- A throw inside a callback never unwinds through the C frames. The program
  stops with status 1, naming the boundary
  ([errors](../language/errors.md#callbacks-a-host-invokes)).
- Compiled code runs on its owner thread. A completion from another thread
  reaches the heap only through the host (`post_from_any_thread`), and a
  binding whose promise waits on one brackets it with `nts_pending_begin` and
  `nts_pending_end` (`c:pending`), so the program keeps running meanwhile.

### The witness

A native build of a program that binds C compiles `native_witness.c` before
linking. It includes the headers the bindings name and asserts each bound
function's type (`__builtin_types_compatible_p`) and each record's size and
member offsets. A binding that disagrees with the real header fails the build
instead of miscompiling, and a header named by a module must declare every
symbol bound to it.

### Generating a binding: `nts bind-c`

```sh
nts bind-c --module c:epoll --header sys/epoll.h \
  --record epoll_event --record epoll_data \
  --fn epoll_create1 --fn epoll_ctl --fn epoll_wait \
  --no-escape epoll_ctl:event --alias epoll_event=EpollEvent \
  --out types/epoll.d.ts
```

- It runs clang as a subprocess (`-ast-dump=json` for the declarations,
  `-fdump-record-layouts` for the layouts), recomputes each layout by the
  compiler's own rules, and refuses with both numbers where they differ.
- A header does not say what a callee keeps, so `--no-escape` states it;
  `--alias` names a tag. Constants named with `--const` go to a `.ts` of their
  own (`--constants-out`). A variadic tail is written as `...rest: unknown[]`,
  which does not compile until the binding types it.
- It binds the items it is named, and generates signatures only, never
  ownership. Binding whole headers, with an overrides file, is decided for
  after ResourceFlow ([Decisions](#decisions)).
  The flags are in the [CLI reference](../reference/cli.md#nts-bind-c).

## C calling TypeScript

The C emission writes `program.h` beside `program.c`. It declares the entry
module's exported functions under their exact C symbols (a name C reserves
gets a suffix: `bool` is `bool_`), a stable alias for each object type a
signature names (`<export>_<parameter>_t`, `<export>_return_t`) with its
checked layout, and the module initializer where there is one.

| TypeScript | C |
|---|---|
| `number` | `double` |
| `boolean` | `bool` |
| `string` | `NtsString *` |
| `number[]` | `NtsArray *` |
| `Uint8Array` | `NtsView *` |
| an object | `<export>_return_t *`, `<export>_<parameter>_t *` |
| `Promise<T>` | `NtsPromise *` |
| a generator | its frame, stepped by `<export>_next(frame, &value)` |

```c
#include "program.h"

int main(void) {
  printf("%g\n", add(2.0, 3.0));               /* double add(double, double) */
  makePoint_return_t *point = makePoint(7.0);  /* checked layout */
  printf("(%g, %g)\n", point->x, point->y);
  nts_release((NtsHeader *)point);             /* a managed result is the caller's */
}
```

- A library that exports only scalars links without `nts_runtime.c`; any
  managed type needs it.
- C makes strings with `nts_string_from_utf8(bytes, length)` and number arrays
  with `nts_array_of_numbers(length)`.
- **Promises:** `nts_checkpoint()` drains the microtasks, after which
  `nts_promise_state` and `nts_promise_value` read the result.
  `nts_promise_join(p)` drives the host until `p` settles; it runs on the owner
  thread, between tasks, and answers `NTS_JOIN_REENTRANT` or
  `NTS_JOIN_WRONG_THREAD` otherwise.
- **Generators:** `<export>_next` answers true for each yield and false once
  done; a yielded managed value is borrowed until the next step. An async
  generator is not stepped from C.
- An exported class publishes its layout and none of its methods. Objects are
  decided to cross the C ABI as opaque handles, with generated Swift, Kotlin
  and Java wrappers later ([Decisions](#decisions)).

## Ownership of C pointers

- **A plain C pointer is a word nts never counts.** An `Opaque` handle or a
  `Ptr` has no header, no retain, no release and no tracing. It is destroyed by
  the library's own call or by `free`, and whoever captures one must keep it
  alive for every use.
- **What the compiler checks:** storage from `local` never escapes its frame,
  into a callee that may keep it, a closure, a suspended `await` or a return;
  `@ntsNoEscape` is the contract that check relies on.
- **Counted families are the exception.** GObject, Objective-C, COM and Blink
  objects are counted by the compiler with their family's own pair, and their
  pages say how.
- **ResourceFlow: designed, not built.** Checked ownership, borrowing, escape
  and cleanup over native operations, so that an obligation such as "destroy
  what `counter_new` returned" or "unsubscribe before freeing the context" is
  discharged at compile time. The ownership vocabulary arrives together with
  its enforcement, never as an unchecked annotation; ResourceFlow is decided
  to be built that way ([Decisions](#decisions)).

## Open questions

- A bundled toolchain, and LLVM's version:
  [T-1, T-2](../open-questions.md#6-bindings-products-toolchains-dependencies).

## Decisions

- Shipped native programs count references; `NoGc` is for testing only
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- One analysis before counting gives every allocation site one home; workers
  are isolated heaps with non-atomic counts; weak references follow the
  specification exactly; mimalloc is tried first; the language has no memory
  annotations (M1 to M5,
  [log](../records/notebooks/decisions-log.md#memory-management-10-27)).
- x86-64 builds default to x86-64-v3, with `cpu: "baseline"` as the portable
  opt-out; `nts build` uses ThinLTO, and benchmarks build exactly as it does
  ([log](../records/notebooks/decisions-log.md#numbers-and-json-10-22)).
- Intl on native uses ICU4C, with a static C++ standard library only in
  programs that use Intl (D3,
  [log](../records/notebooks/decisions-log.md#unicode-10-27)).
- `node:*` APIs are native only, for now (decision 8,
  [log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
- An exception escaping a callback is the program's uncaught error: on a
  command-line program it is printed as node prints it and the process exits
  with status 1
  ([log](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- nts never depends on a system package
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
  What a program may link is the dependency policy's, still to be written
  (D-1, [foundations](../foundations/README.md#decisions)); today's host
  builds still link the system's libuv and libcrypto (contradictions 3 and 4
  in [open questions](../open-questions.md#contradictions)).

From the open-questions audit (10-28):

- **The compiler's hosts:** Linux, then macOS on Apple silicon, then native
  Windows; WSL serves meanwhile (T-3,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- **Debugging:** `#line` and line tables in every build by default, frame
  pointers on if they measure cheap, and an unoptimized debug profile (X-1,
  [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).
  Not built.
- **The library ABI version** of record
  [0018](../records/0018-module-evaluation-and-the-library-abi.md) is to be
  built now, not later (X-7,
  [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).
  Not built yet.
- **ResourceFlow comes with its enforcement,** and after it `bind-c` binds
  whole headers, with an overrides file (I-5, B-1,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
  Not built.
- **Objects cross the C ABI as opaque handles;** generated Swift, Kotlin and
  Java wrappers come later (S-2,
  [log](../records/notebooks/decisions-log.md#products-toolchains-and-dependencies-10-28)).
- **A C embedder settles promises through `nts_checkpoint`,** the documented
  contract above (I-4,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
- **Threads nts does not own** follow one rule: every entry is checked, a
  callback is carried to the owner thread, and a call that must return a value
  from another thread is refused ([async](../language/async.md#decisions)).

A new decision of 10-28:

- **nts is a Node-API host:** a native program (C or LLVM) loads a Node-API
  addon, a `.node` file, as node, Bun and Deno do, so npm packages that ship
  native addons, such as `sharp`, run; the JVM and browsers load no native
  code. It is not the [Node addon](node-addon.md) target, in which nts builds
  an addon that node loads (10-28,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
  Not built; what is still to design is register
  [I-10](../open-questions.md#5-interop-and-hosts).
