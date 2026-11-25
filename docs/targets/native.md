# Native

Programs compiled to machine code through the C or LLVM backend: command-line
programs and libraries for Linux, macOS and Windows, how such a program calls
C, and how C calls it. For anyone building a native artifact or binding a C
library. The platform UI SDKs have pages of their own ([GTK](gtk.md),
[Apple](apple.md), [Windows](windows.md)), as does the
[Node addon](node-addon.md).

## Where it runs

| platform | architectures   | how it is built                                                      | where it has run                 |
| -------- | --------------- | -------------------------------------------------------------------- | -------------------------------- |
| Linux    | x86-64          | this machine's clang, linked against libuv                           | gated                            |
| Linux    | aarch64         | cross-built, statically against musl (`CC=tooling/linux/cc-musl.sh`) | under qemu, in the interop tests |
| macOS    | x86-64, aarch64 | cross-built from Linux ([Apple](apple.md))                           | x86-64 on a VM; arm64 never      |
| Windows  | x86-64, aarch64 | cross-built with zig's mingw ([Windows](windows.md))                 | x86-64 on a VM; arm64 never      |

The compiler itself runs on Linux. macOS on Apple silicon is to be its next
host, then native Windows, and WSL serves meanwhile ([Decisions](#decisions)).
An x86-64 build targets x86-64-v3 (AVX2, BMI2, FMA) and stops by name on an
older CPU; a target with `cpu: "baseline"` builds for every x86-64 CPU.

## Two backends, one runtime

- **C** (`nts emit-c`) writes C11 for GCC or clang. It is the readable one,
  and the oracle the LLVM backend's output is compared against.
- **LLVM** (`nts emit-llvm`) writes textual IR that `clang -x ir` compiles. The
  `nts` binary links no LLVM library, so no LLVM version is pinned into it
  (register [T-2](../open-questions.md#6-bindings-products-toolchains-dependencies)).
  `nts build` uses the Clang-family driver named by `CC` (`clang` or `zig cc`,
  including wrappers). Other drivers, including GCC, refuse before binding
  generation, compilation or linking, naming the product and compiler command.
  It classifies records passed by value for System V, Win64 and AAPCS64.
- **LLVM is the frontier native backend, and C is held equally.** Both meet
  [the bar](../README.md#the-bar) on every row, and a row where one of them is
  slower than the other is a defect of the slower one. The LLVM IR states to
  the optimizer everything nts
  proves (designed, not built): which accesses cannot alias, from the
  layouts (type-based alias metadata, alias scopes), that a fresh allocation
  aliases nothing, which integer operations cannot overflow (`nsw`, `nuw`),
  which address computations stay inside their object (`inbounds`), which
  pointers are non-null and dereferenceable, which functions cannot unwind
  and what memory they touch, the ranges of lengths and integers, and the CPU
  each function is built for. C can say only part of
  this, so LLVM is where nts can pass C.
- **Linkage follows the product:** in an executable, a definition is
  external only if something outside resolves it by name: an entry point, a
  name the product publishes, a name the dynamic loader or a by-name
  registry looks up, or a symbol native code links against. A function
  native code receives only as a pointer (an Objective-C method
  implementation, a callback registered by address) needs no symbol and
  stays private, though it is kept. Everything else, a module's unpublished
  exports included, is `internal` in LLVM and `static` in C, from one
  decision both backends read. A library keeps its external ABI.
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

| host           | file              | used by                                       |
| -------------- | ----------------- | --------------------------------------------- |
| libuv          | `nts_uv_host.c`   | executables                                   |
| GLib           | `nts_glib_host.c` | GTK programs                                  |
| CoreFoundation | `nts_cf_host.c`   | Apple programs that send Objective-C messages |
| Win32          | `nts_win_host.c`  | every Windows executable                      |
| test           | `nts_test_host.c` | `nts check`: virtual time, no I/O             |

A library has no loop. A C program that embeds one and wants its timers or I/O
installs a host of its own (`nts_host_install`).

For a position-independent product, `nts build` probes the resolved C compiler's
predefined macros once before compiling its generated code and bundled runtime.
GCC compiles those units with `-fno-semantic-interposition`: internal calls use
their definitions even when a symbol is published. Clang keeps its existing
flags. The linker still selects the published ABI. Foreign C sources retain
their own interposition semantics, and the flag is not passed to the link.
A failed compiler probe stops the build with its diagnostic.

## Bundled dependency archives

`build/src/node_deps` builds the selected libraries from the embedded Node
source bundle. Its invocation owner maps that bundle's extraction directory
to `/nts/node-deps/<bundle SHA>` for file macros and debug information. A
compiler support probe compiles one tiny debug object in exclusive owned
scratch outside the bundle. It checks tagged file macros and refuses physical
bundle or probe paths in the object before library objects are compiled;
caller prefix maps are refused in flags, leading arguments and configuration.
Shipped assertion strings therefore name the virtual bundle path.
Source operands are bundle-relative and compiled from the bundle's directory,
so LLVM bitcode's source filename is relative too. The owner maps their `./`
file macros to the same virtual prefix. A bitcode probe keeps the route's LTO
flags and is decoded by that same compiler for represented-string inspection.
COFF object commands also suppress CodeView's physical command-line record
and set a virtual compilation directory and object name. Object names derive
from bundle-relative source paths. Other object formats do not receive those
COFF flags. Compiler search observations exclude the exact primary input from
the first numeric linemarker, while retaining forced-header parents.

The archive key includes a versioned mapping policy, source content, recipe,
tools and flags. Bundle observations are relative to the bundle and validated
against the caller's extraction root; external headers and tools keep their
absolute paths and content checks. Archives use deterministic metadata and
sorted members. Moving an otherwise identical private cache reuses its entry
after source and observation validation. Previous key generations are retained;
the native dependency cache has no automatic eviction policy.

## Products

| product        | constructor                                                       | artifact                                                         |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| executable     | `app.cli`, `app.linux`, or `app({ kind: "executable", targets })` | the program, with its host                                       |
| shared library | `library.native`                                                  | `.so`, `.dylib`, or `.dll` with its import `.lib`                |
| static library | `library.staticNative`                                            | `.a`, holding the runtime and the program                        |
| XCFramework    | `library.xcframework`                                             | refused by name: build `shared-library` slices and assemble them |

- A library's surface is what its `entry` module exports, and nothing else:
  the program is rooted there, and a shared library's link hides every other
  symbol.
- A library initializes itself: module evaluation runs from a load-time
  constructor (`nts_auto_init`) before any consumer code. An executable runs
  it from its `main`.
- `soname` overrides the shared library's derived name.

An executable's command line is node's for a single executable application,
since a compiled program is its own entry: `process.argv` is the
executable's resolved path, then `argv[0]` as it was invoked (where node puts
a script's path), then every argument verbatim; `process.argv0` is `argv[0]`
as invoked; `process.execArgv` is empty, because nothing on the line is an
engine flag. `main` hands `argc` and `argv` to `nts_command_line_capture`
before module evaluation. Each value is made on its first read, once per
environment, and every later read answers the same object, so a write to
`process.argv` is seen by the next read. The environment holds them for its
life. On Windows the `argv` handed over is advisory: the line is read again
from `GetCommandLineW` and split by the C runtime's rules, as node's `wmain`
reads it, so an argument outside the ANSI code page arrives whole. A library
captures nothing, since its process is its host's: a host may call
`nts_command_line_capture` itself, and a read with nothing captured is
refused. TypeScript reaches these through the `node:process` provider, which
is still to come ([builtins](../foundations/builtins.md), stage 9), so a
read of `process.argv` is NTS1100 until then.

Every field is in the [`nts.config.ts` reference](../reference/nts-config.md).

## Calling C

A C library is a `c:<name>` module whose declarations are the library's ABI:
generated from its headers by `nts bind-c` ([C headers](c-headers.md)), or
from a platform's metadata for GObject, Objective-C and Windows
([GTK](gtk.md), [Apple](apple.md), [Windows](windows.md)). The C API is
written with TypeScript's values: struct objects, `Ref`, typed arrays,
strings and functions. How a program calls a binding, and the contract each
call keeps, is [Calling C](calling-c.md).

### The witness

A native build of a program that binds C compiles `native_witness.c` before
linking. It includes the headers the bindings name and asserts each bound
function's type (`__builtin_types_compatible_p`) and each record's size and
member offsets. A binding that disagrees with the real header fails the build
instead of miscompiling, and a header named by a module must declare every
symbol bound to it. Every binding names its header, so the witness always
has one to compare against.

## C calling TypeScript

The C emission writes `program.h` beside `program.c`. It declares the entry
module's exported functions under their exact C symbols (a name C reserves
gets a suffix: `bool` is `bool_`), a stable alias for each object type a
signature names (`<export>_<parameter>_t`, `<export>_return_t`) with its
checked layout, and the module initializer where there is one. An export
whose C name would start with `__nts_`, the prefix nts reserves for its own
generated names, is refused (NTS2007): rename it, or give it an explicit C
name outside that prefix.

| TypeScript   | C                                                    |
| ------------ | ---------------------------------------------------- |
| `number`     | `double`                                             |
| `boolean`    | `bool`                                               |
| `string`     | `NtsString *`                                        |
| `number[]`   | `NtsArray *`                                         |
| `Uint8Array` | `NtsView *`                                          |
| an object    | `<export>_return_t *`, `<export>_<parameter>_t *`    |
| `Promise<T>` | `NtsPromise *`                                       |
| a generator  | its frame, stepped by `<export>_next(frame, &value)` |

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

- **A pointer C holds is a word nts never counts.** An opaque handle or a
  `Ptr` has no header, no retain, no release and no tracing. The program
  releases it with the library's own call or with `free`, as C does
  ([Calling C](calling-c.md#handles)).
- **A pointer the program stores into its own C memory is held.** A struct
  object, `CArray` or `Ref` keeps the target of a pointer stored into it
  alive until another value replaces it or the object dies, in a side table
  the cycle collector traces ([Calling C](calling-c.md#arrays-and-buffers)).
- **What the compiler checks** is in
  [Calling C](calling-c.md#what-nts-checks): a lent value living to its
  block's end, nested references holding their root, an address passed only
  as a direct argument, a lent buffer never detached, and every pointer tested
  for `null` before use.
- **Counted families are the exception.** GObject, Objective-C, COM and Blink
  objects are counted by the compiler with their family's own pair, from
  their metadata, and their pages say how.
- **ResourceFlow** checks the ownership facts a platform's metadata states,
  and for plain C it is the checks above. A plain header states no ownership,
  so nothing about a plain C handle is enforced beyond what C itself enforces.

## Open questions

- A bundled toolchain, and LLVM's version:
  [T-1, T-2](../open-questions.md#6-bindings-products-toolchains-dependencies).

## Decisions

- The LLVM backend compiles IR with the Clang-family driver `CC` names.
  Toolchain selection identifies the resolved command once through its predefined
  macros, including wrappers; LLVM preflight and PIC policy share that answer.
  Unsupported drivers refuse before binding generation or compilation. A future
  nts-owned IR compiler would change this driver requirement
  ([log](../records/notebooks/decisions-log.md#llvm-build-driver-11-22)).
- PIC products use one compile-time interposition policy for nts-owned code:
  GCC receives `-fno-semantic-interposition`, including through compiler wrappers;
  clang's arguments stay unchanged
  ([log](../records/notebooks/decisions-log.md#native-pic-interposition-11-21)).
- The runtime's symbols are hidden at compile time, so each product keeps its
  own runtime. `nts_runtime.h` defines `NTS_RUNTIME_SYMBOLS_BEGIN` and `_END`
  once. They are `#pragma GCC visibility push(hidden)` and `pop` on ELF and
  Mach-O under GCC and clang, and nothing elsewhere, because a COFF DLL exports
  only what its definition file names. The header brackets its declarations,
  and every runtime source brackets what it defines after its system includes,
  including vendored code. The one exception is zmij's source, which re-includes
  `<assert.h>`: it stays outside, and its functions take hidden from its API
  header, which is inside. No header declaring an external symbol is included
  inside a region. On ELF that is a link error (`undefined hidden symbol`),
  never a misbinding; Mach-O has no such net. The linker merges a symbol at the
  strictest visibility of its declarations, so the LLVM backend's `declare`s
  resolve inside the product too, with no build flag. No runtime symbol is
  exported: a host reaches a product through the program's published names,
  and an addon through the Node-API entry points `node_api.h` declares. A
  static archive's hidden symbols still resolve in a static link, so its host
  keeps calling the embedding API. Hidden, one product's references cannot bind
  to another's runtime, even with both loaded `RTLD_GLOBAL`. An addon's own
  translation unit declares the program symbols it references hidden ([node-addon](node-addon.md#decisions);
  [log](../records/notebooks/decisions-log.md#runtime-symbols-are-their-products-own-11-23)).
- A shared library's ELF exports are defined under one named version node,
  its file name or soname. Unversioned, an export named like a libc function
  (`error`) lost the library's own calls to glibc's when a host loaded libc
  first, and took glibc's place for other objects' `error@GLIBC_2.2.5` when a
  host linked the library first. Named, the library's references require its
  own version and other objects' versioned references skip it; exported names
  are unchanged. Protected visibility was rejected: it fixed the first
  direction only, and breaks a non-PIE host taking an export's address
  (pointer inequality under ld.bfd, `cannot preempt symbol` under lld).
  Build flags (`-fvisibility=hidden`, `-Bsymbolic`) were rejected because
  binding must not depend on each builder remembering them. musl's loader,
  and bionic's before API 23, ignore version names
  ([log](../records/notebooks/decisions-log.md#exports-named-like-libc-functions-11-23)).
- Bundled native archives have content identity across extraction roots.
  One invocation owner supplies and verifies the source prefix maps, and
  records the virtual bundle location rather than an extraction directory.
  Runtime assertions and debug information use `/nts/node-deps/<bundle SHA>`;
  bundle-relative observations replay at each caller's root while external
  observations remain checked. Caller mappings refuse rather than competing
  with the owner. Old cache generations remain untouched
  ([log](../records/notebooks/decisions-log.md#native-dependency-content-identity-11-15)).
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
- An executable's command line follows node's single-executable rule
  (`FixupArgsForSEA`, then `patchProcessObject` without `expandArgv1`):
  `argv[0]` is `execPath`, `argv[1]` is `argv[0]` as invoked, and `execArgv`
  is empty. A compiled program has no script, and this is node's own answer
  for a program that is its executable; resolving `argv[1]` to a path was
  rejected because node resolves it only for a script it loads (11-25,
  [log](../records/notebooks/decisions-log.md#an-executables-command-line-11-25)).
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
- An export's derived C name is its published contract and is never escaped;
  one in nts's reserved `__nts_` prefix is refused (NTS2007) (10-31,
  [log](../records/notebooks/decisions-log.md#native-export-names-10-31)).

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
- **ResourceFlow comes with its enforcement** where a platform's metadata
  states ownership (I-5,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
  For plain C its work is the checks of
  [Calling C](calling-c.md#what-nts-checks), and `bind-c` binds whole headers
  directly, with no overrides file (B-1, reworded by the user on 10-30,
  [log](../records/notebooks/decisions-log.md#calling-c-10-30)). Not built.
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

From 10-30:

- **Calling C** is the C API as the header declares it, written with
  TypeScript's values; refined APIs are TypeScript packages over a binding, or
  Node-API addons; `node:ffi` is kept in mind for later
  ([Calling C](calling-c.md#decisions),
  [log](../records/notebooks/decisions-log.md#calling-c-10-30)). Not built.
