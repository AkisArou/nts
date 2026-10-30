# C interop designs: a sourced survey for nts (as of 2026-10-30)

Survey B. Scope: how six toolchains (Go cgo, Zig, Kotlin/Native cinterop, Dart FFI,
Vala, Nim) handle thirteen interop concepts, and which annotation vocabularies a C
header or a side file can carry (clang bounds-safety and lifetime/nullability/ownership
attributes, API notes, GCC `access`/`malloc(dealloc)`, Microsoft SAL and
win32metadata, GObject Introspection), with their upstream status and real-world use.
Each concept ends with a recommended design and documented pitfalls. A final section
maps the findings onto nts's own open questions (`docs/targets/c-headers.md`,
`docs/targets/native.md`), which were read but not modified.

## 0. Versions, method, legend

| Subject | Version surveyed | Released | Source of the version |
|---|---|---|---|
| Go | 1.27 (local `go1.27.3`) | Aug 2026 | `go version`; https://go.dev/doc/go1.27 |
| Zig | 0.17.0 (local) | 2026-10-01 | `zig version`; https://ziglang.org/download/index.json |
| Kotlin | 2.4.21 (2.5.0-Beta2 exists) | 2026-10-08 | GitHub releases of JetBrains/kotlin |
| Dart SDK / ffigen / package:ffi | 3.13.7 / 23.0.0 / 2.2.0 | 2026-10-22 / 10-06 / 02-11 | dart-archive VERSION; pub.dev API |
| Vala | 0.56.19 | 2026-03-30 | GNOME GitLab tags |
| Nim | 2.4.0 (latest tag); docs read from `devel` | - | GitHub tags |
| clang | 23.1.3 (local); `release/23.x` and `main` sources | - | `clang --version` |
| GCC | 16.2.1 (local); current online manual | - | `gcc --version` |
| glibc | 2.44 (local headers) | - | `ldd --version` |
| GObject Introspection | 1.86.0 (latest tag seen); 131 local GIR files | 2025-09 | GNOME GitLab tags |
| SQLite (used as the running example) | 3.54.0 (local `sqlite3.h`) | - | `SQLITE_VERSION` |

Method. Primary documents were downloaded as source text (Go `src/cmd/cgo/doc.go`,
Zig language reference and release notes, kotlin-web-site Markdown, `dart:ffi` and
`package:ffi` sources, vala-docs Markdown and the Vala manual, Nim `doc/*.md`, clang
`Attr.td`/`AttrDocs.td`/release notes/`APINotes.rst`/`BoundsSafety*.rst`, the GCC
manual, MicrosoftDocs `cpp-docs`, win32metadata `docs/`, the GI annotation reference)
and quoted from. Compiler behaviour was tested with tiny headers under
`scratch-b/` (clang 23.1.3, gcc 16.2.1); no builds were run.

Legend used on every claim that is not obvious:

- **[doc]** stated in the cited primary documentation;
- **[code]** read in the project's own source code;
- **[local]** verified on this machine (clang 23.1.3, gcc 16.2.1, installed headers/GIRs);
- **[secondary]** only a forum or blog says so;
- **[inferred]** my reasoning from sourced facts, not stated by a source;
- **[unverified]** could not be confirmed from a source.

The running example throughout is SQLite, because its header documents in prose
every hard case: a borrowed result (`sqlite3_column_text`), a dependent handle
(statement on connection), a release that can fail (`sqlite3_close` returns
`SQLITE_BUSY`), a data-lifetime contract (`SQLITE_STATIC`/`SQLITE_TRANSIENT`), and a
handle-scoped error string (`sqlite3_errmsg`).

---

# Part A. The thirteen concepts, toolchain by toolchain

## 1. Where binding facts come from

The facts a binding needs split into **ABI facts** (types, layout, enum values,
constants, calling convention, variadic-ness), which a C front end can read from the
header, and **semantic facts** (ownership, lifetimes, nullability, counts, outputs,
error convention, callback lifetime), which a C prototype does not state (nts's
`~/Projects/nts/docs/targets/c-headers.md` lists the same split under "What it cannot
know"). Code examples are quoted or adapted from the cited source unless marked
*(illustrative)*, in which case I wrote them to show the documented rule. Each
toolchain:

**Go cgo.** The C preamble (a comment before `import "C"`) plus `#cgo CFLAGS/LDFLAGS`
directives. cgo does not parse C: "It determines the meaning of C identifiers not by
parsing C code but by feeding carefully constructed programs into the system C
compiler and interpreting the generated error messages, debug information, and object
files", and "first invokes gcc -E -dM on the preamble, in order to find out about
simple #defines" [doc]. The only semantic facts cgo accepts are `#cgo noescape` and
`#cgo nocallback` (Go 1.24) [doc].

*(illustrative)*
```go
// #cgo pkg-config: sqlite3
// #include <sqlite3.h>
// #cgo noescape sqlite3_blob_read
import "C" // the directive states that sqlite3_blob_read keeps no Go pointer
```
Sources: https://pkg.go.dev/cmd/cgo ("Optimizing calls of C code"; internal notes in
https://github.com/golang/go/blob/master/src/cmd/cgo/doc.go), https://go.dev/doc/go1.24#cgo

**Zig.** Headers are translated to a Zig module by translate-c. Since 0.16.0 it is
"based on arocc and translate-c instead of libclang" [doc 0.16 notes]; `@cImport` was
deprecated in 0.16.0 and "is now removed" in 0.17.0, where C translation is an
explicit package dependency (`codeberg.org/ziglang/translate-c`) used from
`build.zig` [doc 0.17 notes]. Package options: `pub_static`, `func_bodies`,
`keep_macro_literals`, `default_init`, `strict_flex_arrays` [doc README]. No
semantic annotation is read: a pointer becomes `[*c]T`, except pointers to opaque
types and function pointers, which become `?*T` [code `Translator.zig`]. The
alternative is a hand-written `extern fn` stating `*T`, `?*T`, `[*]T`, `[*:0]const u8`.

*(adapted from the translate-c README)*
```zig
const translate_c = b.dependency("translate_c", .{});
const t: Translator = .init(translate_c, .{ .c_source_file = b.path("src/c.h"),
    .target = target, .optimize = optimize });
exe.root_module.addImport("c", t.mod);
```
Sources: https://ziglang.org/download/0.16.0/release-notes.html,
https://ziglang.org/download/0.17.0/release-notes.html,
https://codeberg.org/ziglang/translate-c (README, `src/Translator.zig`)

**Kotlin/Native.** A `.def` property file per library (`headers`, `headerFilter`,
`compilerOpts`, `linkerOpts`, `excludedFunctions`, `strictEnums`/`nonStrictEnums`,
`noStringConversion`, `allowedOverloadsForCFunctions`, ...) plus custom C
declarations after a `---` line, "treated as part of the header file" [doc]. The C
import is Beta and every generated declaration carries `@ExperimentalForeignApi`
[doc]. That cinterop parses through libclang is [unverified] (the docs say only "The
tool analyzes C headers").

*(two examples from the `.def` page combined)*
```
headers = png.h
headerFilter = png.h
package = png
---
static inline int getErrno() { return errno; }
```
Sources: https://kotlinlang.org/docs/native-definition-file.html,
https://kotlinlang.org/docs/native-c-interop.html

**Dart FFI.** `package:ffigen` parses headers with libclang ("LLVM must be installed
... Version 18 or newer is recommended") and is configured by a Dart script; "The YAML
configuration format is deprecated" (ffigen 23.0.0) [doc]. Visitors include, exclude
and rename AST nodes. Nothing in the docs reads C nullability or ownership annotations
for C functions [unverified that none is read].

```dart
final generator = FfiGenerator(
  output: Output(dart: DartOutput(path: root.resolve('lib/add.g.dart'))),
  input: Input(entryPoints: [root.resolve('src/add.h')]),
  visitors: [Visitor(func: (node) => node.isIncluded = node.name == 'add')]);
```
Source: https://github.com/dart-lang/native/blob/main/pkgs/ffigen/README.md

**Vala.** A VAPI file in Vala syntax with `[CCode (...)]` attributes is the binding.
For GObject libraries it is generated from GIR by `vapigen`, and generation "can be
tweaked with a `.metadata` file" (e.g. `poppler_page_get_size.width is_out="1"`)
instead of editing the VAPI [doc]; for other libraries it is written by hand [doc].
Vala does not check a VAPI against the header; the C compiler compiles the generated
C against `cheader_filename`, which catches some mismatches [inferred].

```vala
[CCode (cheader_filename = "atasmart.h")]
namespace AtaSmart {
  [Compact] [CCode (free_function = "sk_disk_free", cname = "SkDisk", cprefix = "sk_disk_")]
  public class Disk { public static int open (string name, out Disk? disk); }
}
```
(from the installed `/usr/share/vala/vapi/atasmart.vapi` [local]). Sources:
https://docs.vala.dev/guides/bindings/generating-a-vapi-with-gobject-introspection.html,
https://docs.vala.dev/guides/bindings/writing-a-vapi-manually.html

**Nim.** Hand-written `importc` declarations with a `header` pragma, which makes the
generated C `#include` the real header, so the C compiler checks every use; "This will
not work for the LLVM backend" [doc]. Generators: the official `c2nim` ("meant to be
tweaked") and the third-party libclang-based Futhark ("Automatic wrapping of C headers
in Nim") [doc repo descriptions].

```nim
type PFile {.importc: "FILE*", header: "<stdio.h>".} = distinct pointer
proc printf(fmt: cstring) {.header: "<stdio.h>", importc: "printf", varargs.}
```
Sources: https://nim-lang.org/docs/manual.html#foreign-function-interface,
https://github.com/nim-lang/c2nim, https://github.com/PMunch/futhark

**Vocabularies (part B has the detail).** In the header: clang attributes
(nullability, `counted_by` family on fields, `noescape`, `lifetimebound`,
`ownership_*`, `malloc(dealloc)`, handle attributes, `flag_enum`,
`enum_extensibility`), GCC attributes (`access`, `malloc(dealloc)`,
`nonnull_if_nonzero`, `null_terminated_string_arg`, `fd_arg`), SAL, GI doc-comment
annotations. In side files: clang API notes (YAML), GIR (XML generated from annotated
sources), win32metadata's winmd plus its sidecars (`autoTypes.json`,
`WithSetLastError.rsp`, `enums.json`, ...), Vala `.metadata`, Kotlin `.def`. From the
implementation: GI's conventions (const-ness implies transfer; double indirection
implies callee-allocates) [doc], clang 23's `-Wlifetime-safety-suggestions`, which
proposes `[[clang::lifetimebound]]` from intra-TU bodies [doc clang 23 notes], and
Zig translate-c translating `static inline` bodies [code].

**Facts hidden from a clang-based reader [local].**
- glibc gates `__attr_access` and `__attr_dealloc` on `__GNUC_PREREQ (10, 0)` /
  `(11, 0)`; clang defines `__GNUC__ 4`, so under clang `fopen` is declared with only
  `__attribute__ ((__malloc__))`, while gcc sees `__malloc__ (fclose, 1)`. With
  `clang -fgnuc-version=13` the deallocator appears and clang 23 keeps it in the AST
  (`RestrictAttr malloc 1` with a `DeclRefExpr` to `fclose`), but `access` is still
  dropped as an unknown attribute.
- Linux uapi headers define `__counted_by(m)` as empty for userspace
  (`linux/stddef.h`); predefining `-D'__counted_by(m)=__attribute__((counted_by(m)))'`
  makes clang record `__u8[] __counted_by(ctx_len)` for `struct lsm_ctx`.
- Libraries that gate nullability on `__clang__` (lilv, serd, zix) are visible to
  clang: `LILV_NONNULL` is `_Nonnull` under `#if defined(__clang__) &&
  __clang_major__ >= 7` and empty otherwise.

**Best design (recommendation).** Read ABI facts from the header through a real C
front end and verify the stated binding against the header at build time (cgo, Zig,
ffigen and nts's `bind-c` read through a compiler; Nim and Vala get a check by
compiling generated C against the header; nts's witness asserts types, sizes and
offsets). Take semantic facts, in order of trust, from (1) annotations present in the
header, parsed with the annotation macros predefined to their attribute spellings;
(2) curated metadata others maintain (GIR, winmd, API notes), translated; (3) a
per-library override file keyed by C symbol, in the host language's own type syntax
(Vala's VAPI generated from GIR and corrected by `.metadata` files is the closest
  precedent);
never (4) inference from the implementation, except as a suggestion (clang 23's
model). An unknown semantic fact yields the conservative raw binding, not a guess.
Why: ABI facts can be checked mechanically and so cannot drift silently; semantic
facts are not in C types, and every ecosystem that reached safe bindings at scale
(GI, win32metadata, Swift's API notes) states them explicitly.

**Pitfalls.**
- Build-time code execution through in-source binding directives: CVE-2023-29404
  (`#cgo LDFLAGS` flags wrongly treated as optional), CVE-2023-29402 (newlines in
  directory names), CVE-2023-39323 (`//line` bypasses `//go:cgo_` restrictions)
  [doc, https://osv.dev/vulnerability/CVE-2023-29404,
  https://osv.dev/vulnerability/CVE-2023-29402,
  https://osv.dev/vulnerability/CVE-2023-39323].
- A fact the vocabulary cannot state breaks every binding at once: libnm's
  `nm_device_filter_connections()` returns a `GPtrArray` that frees its own elements
  (`g_ptr_array_set_free_func`), so it "should be annotate[d] with "(transfer
  container)" or "(transfer full)", but various bindings treat that differently. To
  make pygobject happy, it would require "(transfer container)", but that breaks vala
  (and vice versa). This leads to a double-free and a crash in anaconda. This is not
  really fixable in libnm" (anaconda commit
  https://github.com/rhinstaller/anaconda/commit/1f04cffc3f4f79e5f2751883ff41513d8eb72e96)
  [doc commit message].
- Translation must use the build's target and flags: "Using the incorrect -target or
  -cflags could result in clang or Zig parse failures, or subtle ABI
  incompatibilities when linking with C code"; `-fshort-enums` turns `enum FOO` from
  `c_uint` into `u8` [doc Zig langref "C Translation CLI"].
- API notes apply only to modules ("cannot be used to modify arbitrary textual
  headers") and "Due to a compiler bug, 'NullabilityOfRet' may change nullability of
  the parameters as well (rdar://30544062)" [doc]; with clang 23 a parameter then
  printed as `db * _Nonnull _Nonnull` [local].
- Go 1.24: "Cgo currently refuses to compile calls to a C function which has
  multiple incompatible declarations" [doc].

---

## 2. Struct layout, storage and copying

**Go cgo.** Layout comes from the C compiler's debug information [doc]. `C.struct_x`
mirrors the C struct; "C struct fields that cannot be expressed in Go, such as bit
fields or misaligned data, are omitted in the Go struct, replaced by appropriate
padding"; unions are byte arrays of the same length; `C.sizeof_T` gives sizes; "Go
structs cannot embed fields with C types" [doc]. Storage: "When passing a Go pointer
to a C function the compiler normally ensures that the Go object lives on the heap",
unless `#cgo noescape` [doc]. `C.malloc` "guarantees never to return nil" and crashes
on out-of-memory [doc].

*(illustrative)*
```go
var st C.struct_stat            // escapes to the Go heap because &st reaches C
if C.stat(cpath, &st) != 0 { /* ... */ }
size := int64(st.st_size)
```
Source: https://pkg.go.dev/cmd/cgo ("Go references to C", "Optimizing calls")

**Zig.** "An extern struct has in-memory layout matching the C ABI for the target";
`packed struct` has the ABI of its backing integer [doc]. Storage is the programmer's:
a local `var` passed by `&`, or an allocator such as `std.heap.ArenaAllocator` (file
`lib/std/heap/ArenaAllocator.zig` in 0.17.0) [code]. translate-c turns structs it
cannot translate (bit-fields among them) into `opaque{}` [doc].

*(illustrative)*
```zig
var st: c.struct_stat = undefined;
if (c.stat(path, &st) != 0) return error.StatFailed;
```
Source: https://ziglang.org/documentation/0.17.0/#extern-struct

**Kotlin/Native.** A struct is an lvalue type `T`; the programmer chooses placement:
`memScoped { alloc<T>() }` (freed at scope exit), `nativeHeap.alloc` (manual free), or
`CValue<T>` for by-value arguments and results (`cValue { }`, `readValue()`,
`useContents { }`, `copy { }`, `placeTo(scope)`); `CValuesRef` sequences passed for a
pointer are a "temporary copy ... valid only until the function returns" [doc].

```kotlin
val fileSize = memScoped {
    val statBuf = alloc<stat>()
    stat("/", statBuf.ptr)
    statBuf.st_size
}
```
Source: https://kotlinlang.org/docs/native-c-interop.html#memory-allocation

**Dart FFI.** `final class P extends Struct { @Double() external double x; }`; native
memory via `calloc`/`malloc` or an `Arena` (`using((arena) { ... })`, "frees all
allocations at the same time") [code `package:ffi`]; `Struct.create<T>()` (3.4) backs
a struct with "a fresh ByteBuffer ... allocated on the Dart heap" [code]; its address
can be passed only through `.address` in a leaf call (3.5) [code].

*(illustrative; `Stat` and `stat` stand for ffigen output)*
```dart
final size = using((arena) {
  final st = arena<Stat>();
  stat(path.toNativeUtf8(allocator: arena), st);
  return st.ref.st_size;
});
```
Sources: https://github.com/dart-lang/native/blob/main/pkgs/ffi/lib/src/arena.dart,
https://api.dart.dev/dart-ffi/Struct/create.html

**Vala.** The compiler decides: a Vala `struct` is a value type, "Struct, but passed
as a Pointer to a Struct"; returning a struct "actually means including a hidden out
parameter"; `Foo?` boxes it on the heap [doc].

```vala
public struct Foo { public int x; }
public Foo get_foo (int x);        // C: void get_foo (int x, Foo *ret);
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/05-00-fundamentals-of-binding-a-c-function/05-01-out-and-reference-parameters-and-return-values.html

**Nim.** "By default, importc types are assumed to be incomplete (their size is
unknown at compile-time)"; `completeStruct` asserts every field matches; Nim decides
by-value or by-reference passing from the type's size, so "when interfacing with a C
library" `bycopy`/`byref` pin it [doc]. With the C backend the C compiler lays out
the real struct [doc header pragma; inferred for layout].

*(adapted from the manual)*
```nim
type InotifyEvent {.importc: "struct inotify_event", header: "<sys/inotify.h>",
                    completeStruct.} = object
  wd: cint
  mask, cookie, len: uint32
```
Source: https://nim-lang.org/docs/manual.html#foreign-function-interface-completestruct-pragma

**Vocabularies.** GI `(out caller-allocates)` (the caller provides the struct) [doc];
win32metadata `[StructSizeField("cbSize")]` ("should be automatically populated with
the size of the struct"), `[NativeBitfield]`, `[FlexibleArray]` [doc]; clang/GCC
`counted_by` on a flexible array member (part B).

**Best design (recommendation).** Layout from the C compiler (clang's record layout,
as `bind-c` already reads) and a build-time witness of size and offsets (nts has
both); fields the language cannot express (bit-fields) modelled, never silently
dropped. Storage chosen by the compiler from the escape fact: a temporary passed where
the callee keeps nothing goes in the caller's frame (Vala's rule; nts `local<T>()`),
which is free, whereas arenas cost an allocation and bookkeeping per object; anything
C may keep needs an owner whose lifetime the binding states. Offer arenas (Kotlin
`memScoped`, Dart `using`) as an explicit API for batches, not as the default.
Auto-fill size fields (win32metadata's `StructSizeField`) is a cheap, high-value fact.

**Pitfalls.**
- Go omits bit-fields and misaligned fields without an error [doc]; Zig demotes
  such structs to opaque [doc].
- Every struct passed by pointer escapes to the Go heap unless `#cgo noescape`,
  and a wrong `noescape` means "the program may crash or see memory corruption" [doc].
- "Enum integer types are implementation-defined and not part of the ABI. Therefore
  FFIgen does a best-effort approach" [doc ffigen 13.0.0 changelog].
- Kotlin `CValuesRef` copies die at return; keeping one is a use-after-free [doc].

---

## 3. Passing the language's own values to C by pointer

**Go cgo.** "All Go pointers passed to C must point to pinned Go memory. Go pointers
passed as function arguments to C functions have the memory they point to implicitly
pinned for the duration of the call." "C code may not keep a copy of a Go pointer
after the call returns, unless the memory it points to is pinned with runtime.Pinner
and the Pinner is not unpinned while the Go pointer is stored in C memory", which
"implies that C code may not keep a copy of a string, slice, channel, and so forth"
[doc]. Memory passed may not contain pointers to unpinned Go memory [doc].
Enforcement: "These rules are checked dynamically at runtime ... The default setting
is GODEBUG=cgocheck=1, which implements reasonably cheap dynamic checks ...
GODEBUG=cgocheck=0 [disables]. Complete checking ... GOEXPERIMENT=cgocheck2 at build
time" [doc]; `go vet`'s cgocall analyzer warns statically about passing "a Go chan,
map, func, or slice to C" [code]. `runtime.Pinner` arrived in Go 1.21 (when
`GODEBUG=cgocheck=2` became `GOEXPERIMENT=cgocheck2`); `runtime/cgo.Handle` in 1.17
"to pass values that contain Go pointers ... between Go and C" as an integer [doc].

*(illustrative)*
```go
var pin runtime.Pinner
buf := new([4096]byte)
pin.Pin(buf)                          // C may keep &buf[0] until Unpin
C.start_read(C.int(fd), unsafe.Pointer(&buf[0]), 4096)
// ... in the completion: pin.Unpin()
```
Sources: https://pkg.go.dev/cmd/cgo#hdr-Passing_pointers, https://pkg.go.dev/runtime#Pinner,
https://pkg.go.dev/runtime/cgo#Handle, https://go.dev/doc/go1.21,
https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/cgocall

**Zig.** No garbage collector and no moving: `c.write(fd, s.ptr, s.len)` passes the
slice's storage; whether C may keep it is the programmer's knowledge [inferred].

**Kotlin/Native.** `usePinned { pinned -> recv(fd, pinned.addressOf(0), ...) }` pins
"on normal and exception paths"; `refTo(0)` "pins the array before entering the
recv() function ... and unpins the array after exiting"; `StableRef.create(x)
.asCPointer()` passes an object reference as `void*`, and the `StableRef` must be
"manually disposed using the .dispose() method to prevent memory leaks" [doc]. With the experimental Latin-1 strings, `String.pin`,
`usePinned` and `refTo` "may trigger an automatic string conversion to UTF-16" [doc].

```kotlin
buffer.usePinned { pinned ->
    recv(fd, pinned.addressOf(0), buffer.size.convert(), 0)
}
```
Source: https://kotlinlang.org/docs/native-c-interop.html#object-pinning

**Dart FFI.** Zero-copy only for a leaf call, enforced at compile time: `.address`
on a `TypedData`, `Struct`, `Union`, `Array` or a field of one "can only occurr [sic] as
an entire argument expression in the invocation of a leaf [Native] external function",
and "is evaluated just before calling into native code ... This ensures the Dart
garbage collector will not move the object" (Dart 3.5) [code]. Otherwise data is
copied into native memory.

*(adapted from the `Uint8ListAddress` doc comment)*
```dart
@Native<Void Function(Pointer<Uint8>, Size)>(isLeaf: true)
external void fill(Pointer<Uint8> p, int n);
final list = Uint8List(64);
fill(list.address, list.length);
```
Source: https://github.com/dart-lang/sdk/blob/main/sdk/lib/ffi/ffi.dart (`Uint8ListAddress`)

**Vala.** Objects do not move; retention is expressed as ownership: an `owned`
parameter transfers the reference to C [doc]. **Nim.** `addr x` gives a raw pointer;
"the implicit [string to cstring] conversion is not *safe*: The garbage collector
does not consider a cstring to be a root and may collect the underlying memory" [doc].

**Vocabularies.** clang `noescape`: "no reference to the object ... derived from the
parameter value will survive after the function returns ... incorrectly annotating a
parameter with noescape leads to undefined behavior", and since clang 23 "the callee
is also not allowed to deallocate memory through a noescape parameter" [doc];
`lifetime_capture_by(X)` (clang 20) says a parameter is captured into `X`, accepted in
C by clang 23 [local]; GI `(transfer full)` on an in parameter; win32metadata
`[Retained]`: "Pointer parameters for OVERLAPPED operations ... must remain allocated
throughout the lifetime of the asynchronous operation" [doc]; SQLite states it in
prose: with `SQLITE_STATIC` "the object and the provided pointer to it must remain
valid until either the prepared statement is finalized or the same SQL parameter is
bound to something else", with `SQLITE_TRANSIENT` it is "copied prior to the return",
with a destructor SQLite frees it "even if the call to the bind API fails" [doc
`sqlite3.h`].

**Best design (recommendation).** Two contracts, and nothing in between:
(a) *borrowed for the call*: zero-copy, enforced statically by restricting where the
address may flow (Dart's "only as an entire argument of a leaf call" and nts's
`local` escape rule are the strongest static enforcements surveyed); (b) *retained
until an event*: the binding names the release event (a destroy-notify, a release
function, finalization or rebinding on a parent handle) and the compiler keeps a
counted reference in the owner until it happens (Go's Pinner and Kotlin's
StableRef are the manual forms; GI's `transfer full` and SQLite's destructor argument
are the declarative forms). Copy only when the representation differs (UTF-16 text to
UTF-8). When a header and the override file are silent, assume (b), as nts already
does ("A parameter without `@ntsNoEscape` may be kept by the callee") and as Go's
escape-to-heap does: the safe default.

**Pitfalls.**
- The Go runtime "may sometimes cause a runtime error if the contents of the C memory
  appear to be a Go pointer ... Zero out the memory in C before passing it to Go"
  (a documented bug) [doc].
- cgocheck=1 is "reasonably cheap", not complete; full checking needs a rebuild with
  `GOEXPERIMENT=cgocheck2` [doc].
- Wrong `noescape` (clang or cgo) is undefined behaviour or memory corruption [doc].
- `SQLITE_STATIC` with a buffer the host language may move or free is a classic
  use-after-free [inferred from the doc's contract].
- Nim's `cstring` conversion can dangle [doc].

---

## 4. Buffers and counts

**Go cgo.** No length facts: `C.CBytes([]byte)` copies into `malloc` memory (caller
frees), `C.GoBytes(p, n)` copies out; a slice is passed as `(*C.char)(unsafe.Pointer
(&b[0])), C.size_t(len(b))` [doc]. "In Go, you must pass the pointer to the first
element explicitly: C.f(&C.x[0])" for C array parameters [doc].

**Zig.** A slice is pointer plus length; `[*]T` many-item, `[*:0]T` sentinel-terminated
("protection against buffer overflow and overreads"); C pointer and length become a
slice by `p[0..n]`, and `std.mem.span`/`std.mem.sliceTo` read sentinel-terminated data
[doc, code]. Slice bounds are safety-checked in safe modes [doc Illegal Behavior].

*(illustrative)*
```zig
const n = c.read(fd, buf.ptr, buf.len);
if (n < 0) return error.ReadFailed;
const got = buf[0..@intCast(n)];
```

**Kotlin/Native.** `CPointer<T>` supports `[]` without a length; `ByteArray.usePinned`
plus `buffer.size.convert()` [doc]. **Dart FFI.** `Pointer<Uint8>.asTypedList(n)`
"Creates a typed list view backed by memory in the address space" (no copy; "The user
has to ensure the memory range is accessible"), and with `finalizer:` (Dart 3.1) the
list adopts a C buffer: the finalizer "will be run on the pointer once the typed list is
GCed"; `.address` lends Dart typed data to leaf calls [code].

**Vala.** The compiler passes lengths: `void foo (double[] array)` becomes
`void foo(double *array, int array_length)`; `array_length_pos` moves the length,
`array_length_type` sets its C type (default `int`), `array_null_terminated`,
`array_length_cexpr`, and `array_length = false` (length unknown, `.length == -1`)
[doc]. "If the caller allocates the memory, you want a buffer, not an out array" [doc].

*(illustrative)*
```vala
public void process ([CCode (array_length_pos = 0.9, array_length_type = "size_t")] uint8[] data);
// C: void process (size_t data_length, uint8_t *data);
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/07-00-binding-a-c-function-s-parameter-and-return-types/07-03-arrays.html

**Nim.** `ptr UncheckedArray[T]` plus an explicit length (the destructors document's
custom `seq` uses `data: ptr UncheckedArray[T]`) [doc]; `openArray[T]` passes pointer
and length between Nim procs [doc].

**Vocabularies.** clang `counted_by`/`sized_by`/`counted_by_or_null`/
`sized_by_or_null`: struct fields only in upstream clang, parameters only in Apple's
fork (part B1) [local]; GCC `access (mode, ref-index, size-index)`, where the size is
"the number of elements of the type referenced by ref-index, or the number of bytes
when the pointer type is void*" [doc], invisible to clang [local]; SAL `_In_reads_(s)`,
`_In_reads_bytes_(s)`, `_Out_writes_(s)`, `_Out_writes_to_(s,c)` ("In post-state, the
elements up to the c-th element must be valid"), `_Inout_updates_(s)` [doc]; GI
`(array length=PARAM)`, `(array fixed-size=N)`, `(array zero-terminated=1)` [doc];
win32metadata `[NativeArrayInfo]` (`CountConst`, `CountParamIndex`, `CountFieldName`)
and `[MemorySize(BytesParamIndex)]` [doc]. Swift 6.2's experimental
`SafeInteropWrappers` turns `__counted_by(len)` plus `__noescape` into `Span<T>`
(`__sized_by` into `RawSpan`); parameters sharing a count get a check that "will trap
if a.count != b.count || b.count != out.count", and an arithmetic count such as
`columns * rows` keeps the factors and checks their product [doc].

```c
int calculate_sum(const int * __counted_by(len) values __noescape, int len);
// Swift overload: func calculate_sum(_ values: Span<CInt>) -> CInt
```
Source: https://www.swift.org/documentation/cxx-interop/safe-interop/

**Best design (recommendation).** One source-level value for a pointer and its
count (a typed array or view), with three facts explicit: the unit (elements versus
bytes, as `counted_by`/`sized_by` and SAL's `_bytes_` variants separate), the count
expression (a parameter, a constant, a field, or arithmetic over parameters, as
Swift handles), and who supplies it (the compiler fills the count from the value,
as Vala and nts's `Counted<A, L>` do). Shared counts are checked equal at the
boundary; output buffers carry capacity in and count written out (SAL's
`_Out_writes_to_(s,c)` is the most precise vocabulary), and the result is a view of
the written prefix. The count's C type is the header's (`size_t`), not `int`.

**Pitfalls.**
- With `counted_by`, the count must be set before the array is touched:
  CVE-2024-53192 (clk-loongson2) fixed a "potential buffer overflow in
  flexible-array member access" where the counter was not set to the allocated size
  (https://osv.dev/vulnerability/CVE-2024-53192); the qcom interconnect fix "Set the
  count member before accessing the flex array"
  (https://lkml.iu.edu/hypermail/linux/kernel/2412.0/05308.html) [doc/secondary].
- Vala's default length type is `int`; a `size_t` length needs
  `array_length_type` [doc]. "Vala does not always null-terminate the arrays it
  creates ... a string[] is null-terminated, but uint[] and const string[] arrays
  are not" [doc].
- GCC: "the access attribute does not imply the attribute nonnull" [doc].
- `memcpy(NULL, NULL, 0)` is undefined before C2y's N3322 (accepted for C2y in 2024
  [secondary]), and glibc 2.44 still declares `memcpy` with `__nonnull ((1, 2))` [doc
  https://open-std.org/JTC1/sc22/wg14/www/docs/n3322.pdf; local].

---

## 5. Strings in both directions

**Go cgo.** Conversions copy: `C.CString(string) *C.char` — "The C string is
allocated in the C heap using malloc. It is the caller's responsibility to arrange for
it to be freed, such as by calling C.free"; `C.GoString(*C.char)` ("If the pointer is
nil, C.GoString returns the empty string"), `C.GoStringN`, `C.GoBytes` [doc]. A C
function declared in the preamble with a `_GoString_` parameter receives a Go string
without a copy; its contents "may not have a trailing NUL byte" and "_GoString_ values
may not be retained by C code" [doc].

```go
cs := C.CString("Hello from stdio")
C.myprint(cs)
C.free(unsafe.Pointer(cs))
```
Source: https://pkg.go.dev/cmd/cgo ("Go references to C")

**Zig.** `[*:0]const u8` is the C string type; passing a non-terminated array is a
compile error ("destination pointer requires '0' sentinel") [doc]. Conversions are
explicit: `std.mem.span(p)` gives a slice of a C string [code]; allocation is the
caller's.

**Kotlin/Native.** "Unlike other pointers, the parameters of type const char* are
represented as a Kotlin String", converted automatically; `noStringConversion` in the
`.def` turns this off per function; `.cstr`/`.wcstr` give temporary `CValuesRef`s;
`toKString()` (UTF-8), `toKStringFromUtf16/32()` decode; "In all cases, the C string is
supposed to be encoded as UTF-8" [doc]. A returned `char *` is a `CPointer<ByteVar>?`
and the tutorial warns "Ensure you use the correct free() function to release the
returned char*" [doc]. Kotlin strings are UTF-16 in memory (optional Latin-1), so every
crossing converts [doc memory manager].

```kotlin
pass_string(str.cstr)
val useMe = return_string()?.toKString() ?: error("null pointer returned")
```
Source: https://kotlinlang.org/docs/mapping-strings-from-c.html

**Dart FFI.** `Pointer<Utf8>`; `String.toNativeUtf8({Allocator allocator = malloc})`
copies, replaces unpaired surrogates with U+FFFD, and a NUL inside the string truncates
a later `toDartString()`; `toDartString({int? length})` decodes up to the first NUL
or exactly `length` units [code].

*(illustrative)*
```dart
final p = 'héllo'.toNativeUtf8();      // malloc'd; free with malloc.free(p)
final s = p.toDartString();
malloc.free(p);
```
Source: https://github.com/dart-lang/native/blob/main/pkgs/ffi/lib/src/utf8.dart

**Vala.** "In Vala, a string is a null-terminated list of UTF-8 data that is
immutable"; ownership decides frees: "All return values and ref and out parameters are,
by default, owned", so a `const char *` result must be declared `unowned string`;
"Frequently, the caller does not free the string, especially if it is marked const"
[doc]. `sqlite3.vapi` binds `sqlite3_column_text` as `public unowned string?
column_text (int col);` and frees `sqlite3_exec`'s error message with
`Sqlite.Memory.free` [code].

**Nim.** `cstring` is `char*`; Nim strings convert implicitly (unsafely, see 3);
`$cstr` copies into a Nim string [doc].

**Vocabularies.** GI defaults: "`gchar*` means `(type utf8) (transfer full)`", "`const
gchar*` means `(type utf8) (transfer none)`", and a distinct `filename` type ("utf-8 on
Windows and a zero terminated guint8 array on Unix") [doc]; SAL `_In_z_`, `_Ret_z_`,
`_Out_writes_z_(s)`, `_Null_terminated_` [doc]; win32metadata `[NotNullTerminated]`,
`[NullNullTerminated]`, `[NativeEncoding("ansi")]`, `[Ansi]`/`[Unicode]` [doc]; clang
`__null_terminated`/`__terminated_by(T)` exist only in Apple's bounds-safety fork
[local: unknown attribute in clang 23]; GCC `null_terminated_string_arg (N)` (GCC only
[local]); clang `lifetimebound` ties a borrowed result to a parameter and works in C
in clang 23 (`return view(buf)` on a local array warns `-Wreturn-stack-address`)
[local]. SQLite states borrowed-result lifetimes in prose: column pointers "are valid
until a type conversion occurs ..., or until sqlite3_step() or sqlite3_reset() or
sqlite3_finalize() is called", and the `sqlite3_errmsg` string "might be overwritten or
deallocated by subsequent calls to other SQLite interface functions" [doc `sqlite3.h`].

**Best design (recommendation).** Three separate facts per string position:
(1) encoding (UTF-8, UTF-16, bytes, platform filename); (2) ownership direction and,
for owned results, the deallocator (`free`, `g_free`, `sqlite3_free`); (3) for
borrowed results, what they borrow from and which calls invalidate them
(`lifetimebound` names the parent; nothing standard names the invalidating calls, so
the override file must). Defaults: a `const char *` parameter is borrowed UTF-8 for
the call; any result is copied immediately into a managed string and never freed
(nts's current rule; GI's `const` convention); an owned result is legal only with a
stated deallocator. Zero-copy views of results only where the compiler can bound the
view's lifetime (nts's planned ResourceFlow), otherwise copy. NUL and lone-surrogate
policies are explicit, as nts already states (U+0000 ends the process; a lone surrogate
becomes U+FFFD; `StringView` crosses exactly).

**Pitfalls.**
- Leaks from `C.CString` without `C.free` [doc implies]; mismatched deallocators
  across libraries (`sqlite3_free` versus `free`; Dart's `toNativeUtf8` defaults to
  `malloc`) [code].
- Kotlin's tutorial example returns a string literal from `return_string()` while
  telling the reader to free it, which shows how ambiguous an unannotated `char *`
  result is [doc].
- Embedded NUL truncates silently (Dart `toNativeUtf8` docs) [code].
- Borrowed SQLite text is invalidated by the next `step`, by `reset`, by `finalize`,
  or by a type conversion; the error message by "subsequent calls" [doc].

---

## 6. Output and in-out parameters

**Go cgo.** Pass `&x` of Go memory, pinned for the call (see 2 and 3); no mapping to
multiple results [doc]. **Zig.** `var out: c_int = undefined; _ = c.f(&out);`
*(illustrative)*. **Kotlin/Native.** `memScoped { val n = alloc<IntVar>(); f(n.ptr);
n.value }` (the documented `stat` pattern) [doc]. **Dart FFI.** `using((a) { final p =
a<Int32>(); f(p); return p.value; })`, or `.address` of a struct field in a leaf call
[code].

**Vala.** `out` and `ref`: "Vala will assume the function will accept a pointer to
this value, which it will populate upon return. A ref parameter is similar, but the
parameter must be initialised before the function is called"; an out array or
delegate returns its length or target as further outs; an out struct is a plain
pointer to caller storage; "Vala always assume an out parameter can be null", and
"Many C libraries do not check that an out parameter is not null before accessing it,
resulting in a segmentation fault. There is no syntax in Vala to prevent this" [doc].

```vala
public int div_and_mod (int a, int b, out int mod);   // C: int div_and_mod(int, int, int *mod)
public static int open (string filename, out Database db);
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/05-00-fundamentals-of-binding-a-c-function/05-01-out-and-reference-parameters-and-return-values.html

**Nim.** For an `importc` proc, `byref` parameters "translate to pointers" [doc]; that
`var T` parameters also become `T *` is [unverified] from the docs read.

**Vocabularies.** GI `(out)`, `(out caller-allocates)`, `(out callee-allocates)`,
`(inout)`, `(optional)` ("the caller can pass NULL to ignore this output parameter"),
`(nullable)` on an out ("NULL may be passed out by the callee"); out and inout default
to `(transfer full)` [doc]. The GI reference also says, for `g_file_get_contents`, "if
the GError is returned set, the value of contents and length might be unspecified and
should therefore not be used or freed" [doc]. SAL separates the levels: `_Outptr_`
("Parameter can't be null, and in the post-state the pointed-to location can't be
null"), `_Outptr_opt_`, `_Outptr_result_maybenull_`, `_Outptr_result_nullonfailure_`,
`_Out_`, `_Inout_` [doc]. win32metadata `[In]`, `[Out]`, `[Optional]`, `[Reserved]`
("always expect a NULL value"), `[RetVal]`, `[ComOutPtr]`, `[IgnoreIfReturn]`
("undefined in failure scenarios") [doc]. GCC `access (write_only|read_write, ...)`
gives a direction, but clang drops it [local].

**Best design (recommendation).** Out parameters become results; the compiler gives
them frame storage (nts's `local`). Four facts per out slot: direction (out/inout);
who allocates (caller storage versus a callee-allocated pointer written through `T **`);
optional versus nullable, kept as two bits because they answer different questions
(may the caller pass NULL; may the callee write NULL), as GI and SAL both learned;
and the ownership of what is written plus its validity on failure. Omit a slot by
passing NULL only where it is declared optional.

**Pitfalls.**
- Vala's "an out parameter can be null" assumption against C that dereferences it
  [doc].
- Outputs are unspecified on failure (GI, SAL `_On_failure_`, win32metadata
  `IgnoreIfReturn`) [doc]; reading or freeing them is a bug.
- GI's deprecated `(allow-none)` conflated nullable and optional; it was "Replaced by
  (nullable) and (optional)" [doc].

---

## 7. Error conventions

**Go cgo.** "Any C function (even void functions) may be called in a multiple
assignment context to retrieve both the return value (if any) and the C errno variable
as an error"; "the C errno value may be non-zero, and thus the err result may be
non-nil, even if the function call is successful. Unlike normal Go conventions, you
should first check whether the call succeeded" [doc].

```go
n, err := C.setenv(key, value, 1)
if n != 0 {
    return err // only now is err meaningful
}
```
Source: https://pkg.go.dev/cmd/cgo

**Zig.** No automatic mapping; the standard library states each function's error set
and translates errno by hand [code `lib/std/posix.zig`, 0.17.0]:

```zig
pub fn kill(pid: pid_t, sig: SIG) KillError!void {
    switch (errno(system.kill(pid, sig))) {
        .SUCCESS => return,
        .PERM => return error.PermissionDenied,
        .SRCH => return error.ProcessNotFound,
        else => |err| return unexpectedErrno(err),
    }
}
```
Source: https://codeberg.org/ziglang/zig/src/tag/0.17.0/lib/std/posix.zig

**Kotlin/Native.** No errno capture is documented in the C interop pages; a `.def`
can expose it with a custom declaration (`static inline int getErrno() { return errno;
}` is the docs' own example) [doc].

**Dart FFI.** `dart:ffi` has no errno capture (no mention in `ffi.dart` [code]); the
`unix_api` package keeps errno in native memory through a C shim because the VM may
clobber it, referring to SDK issue #38832 "Support for capturing errno across calls"
[secondary search result; issue status unverified].

**Vala.** GError is first-class: a VAPI method declared `throws GLib.Error` takes a
trailing `GError **`, and Vala code must handle it ("Vala errors are so-called checked
exceptions ... if you don't catch an error the Vala compiler will only issue a warning")
[doc]. Other conventions stay as return codes: `sqlite3.vapi` returns `int`.

**Nim.** Manual. Exception tracking: "Procs that are importc'ed are assumed to have
.raises: [], unless explicitly declared otherwise" [doc].

**Vocabularies.** GI `throws="1"` for a trailing `GError**` (7,481 of 53,497 callables
in this machine's GIR files [local]); SAL `_Success_(expr)` ("each annotation ... on
the function and in post-condition behaves as if it were coded as `_When_(expr,
anno)`"), `_Return_type_success_` (built into `HRESULT` and `NTSTATUS`),
`_On_failure_`, `_Check_return_`, `_Must_inspect_result_` [doc]; win32metadata
`SetLastError` on `DllImport`, `[CanReturnMultipleSuccessValues]`,
`[CanReturnErrorsAsSuccess]`, `[IgnoreIfReturn]` [doc]; GCC/clang
`warn_unused_result` (610 uses in 122 headers here, and GLib's
`G_GNUC_WARN_UNUSED_RESULT` 1,303 in 332 [local]).

**Best design (recommendation).** A declared convention per function (with a
per-library default), chosen from a small closed set: (1) a success predicate on the
result (`== 0`, `>= 0`, `!= NULL`, membership in a list); (2) where the detail comes
from: errno or GetLastError captured by the generated stub immediately after the call
and read only when the predicate failed (Go's rule), or a handle-scoped query such as
`sqlite3_errmsg(db)` evaluated before any other call on that handle, or an error
out-parameter with its free function (`GError**`); (3) which outputs are valid on
failure. Map it to a thrown, typed `Error` carrying code and message (nts's
`@ntsThrows`), and keep the raw non-throwing call available for hot paths.

**Pitfalls.**
- errno non-zero after success (Go doc) [doc]; errno clobbered by runtime work between
  the call and the read (the Dart case) [secondary].
- `HRESULT` has many success values [doc win32metadata].
- A `GError` must be freed, and the outs beside it are unspecified [doc GI].
- `sqlite3_errmsg` is overwritten by the next call [doc `sqlite3.h`].

---

## 8. Handles and ownership

**Go cgo.** No ownership facts. The idiom is a Go wrapper with an explicit `Close`
plus `runtime.AddCleanup` (Go 1.24: "more flexible, more efficient, and less
error-prone than runtime.SetFinalizer ... New code should prefer AddCleanup") as a
backstop [doc]. Cleanups have "no specified order ... even if the objects form a
cycle", are "not always guaranteed to run ... before program exit", and need
`runtime.KeepAlive` while C still uses the resource: "To ensure a cleanup does not get
called prematurely, pass the object to the KeepAlive function after the last point
where the object must remain reachable" [doc].

*(illustrative)*
```go
type DB struct{ p *C.sqlite3 }
func wrap(p *C.sqlite3) *DB {
    d := &DB{p}
    runtime.AddCleanup(d, func(p *C.sqlite3) { C.sqlite3_close_v2(p) }, p)
    return d
}
func (d *DB) Changes() int { n := C.sqlite3_changes(d.p); runtime.KeepAlive(d); return int(n) }
```
Sources: https://go.dev/doc/go1.24#runtime, https://pkg.go.dev/runtime#AddCleanup,
https://pkg.go.dev/runtime#KeepAlive

**Zig.** Deterministic by hand: `defer` ("Executes an expression unconditionally at
scope exit") and `errdefer` (only "if the function returned with an error from the
block") [doc].

*(illustrative)*
```zig
var db: ?*c.sqlite3 = null;
const rc = c.sqlite3_open(path, &db);
errdefer _ = c.sqlite3_close(db); // sqlite3_open allocates a handle even when it fails
if (rc != c.SQLITE_OK) return error.OpenFailed;
```
(SQLite: "Whether or not an error occurs when it is opened, resources associated with
the database connection handle should be released by passing it to sqlite3_close()"
[doc `sqlite3.h`]; a binding that frees only on success leaks.)

**Kotlin/Native.** Manual disposal; `createCleaner(resource) { it.dispose() }`
(`@ExperimentalNativeApi`, since 1.9) runs "some time after its deallocation", on an
unspecified thread, leaks if the resource refers to the cleaner, and "Cleaners cannot
be used to perform actions during the program shutdown" [code].
Source: https://github.com/JetBrains/kotlin/blob/master/kotlin-native/runtime/src/main/kotlin/kotlin/native/ref/Cleaner.kt

**Dart FFI.** `NativeFinalizer(callbackPtr).attach(value, token, detach: d,
externalSize: n)`: the callback "might be invoked on an arbitrary thread", may not
re-enter the VM, is called "at least once before the isolate group shuts down" but
"can not be relied upon for running actions on the programs exit"; the documented
pattern is an explicit `close()` that calls `detach` and then the native close [code].
`Finalizable` keeps a local "alive until execution exits the code block", which is
what prevents premature finalization during a native call [code]. An `Arena` can own
other resources: `arena.using(resource, releaseCallback)` [code].

*(condensed from the `NativeFinalizer` doc comment)*
```dart
class Database implements Finalizable {
  static final _finalizer = NativeFinalizer(_bindings.closeDatabaseAddress.cast());
  factory Database.open() { final p = _bindings.openDatabase();
    final db = Database._(p); _finalizer.attach(db, p.cast(), detach: db); return db; }
}
```
Source: https://github.com/dart-lang/sdk/blob/main/sdk/lib/ffi/native_finalizer.dart

**Vala.** A compact class is singly owned with `free_function`, or reference counted
with `ref_function`/`unref_function`; returns and outs are owned by default; `(owned)`
transfers; `[DestroysInstance]` marks a method that frees `this`; an immutable compact
class with `copy_function` may be copied [doc]. The compiler inserts the release when
the owning reference leaves scope, emitting `(foo == NULL ? NULL : foo = (unref (foo),
NULL))` [code `valaccodebasemodule.vala`].

```vala
[CCode (cname = "foo", ref_function = "foo_retain", unref_function = "foo_release")]
[Compact]
public class Foo { [CCode (cname = "foo_new")] public Foo (); }
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/04-00-recognizing-vala-semantics-in-c-code/04-05-compact-classes.html

**Nim.** ARC/ORC destructors: "Variables are destroyed via this hook when they go out
of scope"; `=destroy` "is implicitly annotated with .raises: []"; marking `=copy`
with `{.error.}` makes any copy a compile error, giving move-only (unique) handles;
`lent T` returns a borrow "proven by the compiler" not to outlive its origin [doc].
ORC is the default; `--mm:arc` omits the cycle collector [doc].

*(illustrative)*
```nim
type Db = object
  p: ptr sqlite3
proc `=destroy`(d: Db) =
  if d.p != nil: discard sqlite3_close_v2(d.p)
proc `=copy`(a: var Db; b: Db) {.error.}   # move-only: any copy is a compile error
```
Sources: https://nim-lang.org/docs/destructors.html, https://nim-lang.org/docs/mm.html

**Dependent handles and fallible release.** SQLite: "If the database connection is
associated with unfinalized prepared statements ... sqlite3_close() will leave the
database connection open and return SQLITE_BUSY"; `sqlite3_close_v2()` instead marks it
"an unusable zombie" freed when its children finish, and "is intended for use with
host languages that are garbage collected, and where the order in which destructors are
called is arbitrary" [doc `sqlite3.h`]. POSIX `close(2)`: "A careful programmer will
check the return value of close() ... Failing to check the return value when closing a
file may lead to silent loss of data", yet "Retrying the close() after a failure
return is the wrong thing to do, since this may cause a reused file descriptor from
another thread to be closed" [doc man-pages close(2)]. None of the six toolchains
declares "a statement depends on its connection"; Vala's `sqlite3.vapi` exposes
`Statement.db_handle()` as `unowned Database` and nothing more [code].

**Vocabularies.** clang `ownership_returns(kind[, size])`, `ownership_takes(kind,
idx)`, `ownership_holds(kind, idx)` (Clang Static Analyzer; needs
`unix.DynamicMemoryModeling:Optimistic=true`) [doc]; GCC `malloc (deallocator,
ptr-index)` pairs allocator and deallocator (`-Wmismatched-dealloc`), kept in clang 23's
AST but not checked [doc, local]; clang `acquire_handle`/`use_handle`/`release_handle`
("tag") for integer or pointer handles, accepted in C [doc, local]; GI transfer modes
plus `(ref-func)`, `(unref-func)`, `(copy-func)`/`(free-func)` (1.76) [doc];
win32metadata `RAIIFree("CloseHandle")` (default and per-return), `InvalidHandleValue`,
`[FreeWith]`, `[DoNotRelease]` ("unowned and should not be closed"), `AlsoUsableFor`;
`autoTypes.json` records `HANDLE` with `CloseApi: CloseHandle` and
`InvalidHandleValues: [-1, 0]` [doc, code]; API notes `SwiftImportAs: owned|reference`
with `SwiftRetainOp`/`SwiftReleaseOp`, `SwiftCopyable: false` with `SwiftDestroyOp`
(`WGPUAdapterInfo` / `wgpuAdapterInfoFreeMembers`), `SwiftReturnOwnership:
retained|unretained` [doc].

**Best design (recommendation).** The handle's type carries its release function, its
invalid sentinel values and its sharing mode: unique (move-only) by default, shared only
where the library gives ref/unref. Release is deterministic, at the end of the owner's
life (Nim/Vala/Zig `defer` style; nts's reference counting already gives a
deterministic point), and checked statically ("destroy what `X` returned" as nts's
ResourceFlow plans). A fallible release has two paths: an explicit `close()` that
returns or throws the error and is never retried, and the implicit end-of-life
release, which cannot report and so logs or ignores. A dependent handle holds a
counted reference to its parent, so a connection cannot be released before its
statements (the order a GC cannot give: SQLite added `close_v2` for exactly that).
Borrowed handles (`transfer none`, `DoNotRelease`, Vala `unowned`) are never released.
Finalizers are a leak backstop only, never the release mechanism.

**Pitfalls.**
- Vala discards the free function's result (the comma expression above), so a
  failing `sqlite3_close` leaks silently [code; inferred consequence].
- Go cleanups and Kotlin cleaners are unordered and may never run; Go needs
  `KeepAlive`; Dart needs `Finalizable` [doc/code].
- Kotlin: "if [resource] refers (directly or indirectly) the cleaner, then both might
  leak" [code].
- Bindings that read the same transfer annotation differently produce double frees:
  gjs issue 275, "Fix bad memory management in vfunc marshalling" (transfer-full out
  parameters unreffed once too often, freed again at the next collection), and
  PyGObject issue 196, titled `"transfer full" not respected`
  (https://gitlab.gnome.org/GNOME/gjs/issues/275,
  https://gitlab.gnome.org/GNOME/pygobject/-/issues/196) [secondary: issue titles and a
  search summary of their bodies].

---

## 9. Callbacks

**Go cgo.** A Go function becomes callable from C by `//export`; C receives a pointer
to the exported function, since "Calling C function pointers is currently not
supported" from Go [doc]. Context goes through `cgo.Handle` (an integer; "a program
must explicitly call Delete") or a pointer to one when C does not keep it [code].
`#cgo nocallback f` promises `f` never calls back: "If the nocallback directive is used
and the C function does call back into Go code, the program will panic" [doc]. A panic
can unwind out of a callback through the C frames: the runtime's `unwindm` restores
state when "we're panicking out of the callback and unwinding the g0 stack" [code
`runtime/cgocall.go`]; C cleanup in those frames does not run [inferred]. Callbacks on
threads Go did not create are supported: "needm is called when a cgo callback happens on
a thread without an m (a thread not created by Go)" [code `runtime/proc.go`].

```go
//export MyGoPrint
func MyGoPrint(handle C.uintptr_t) {
    h := cgo.Handle(handle)
    println(h.Value().(string))
    h.Delete()
}
```
Source: https://pkg.go.dev/runtime/cgo#Handle

**Zig.** A `callconv(.c)` function is the callback; the context is `?*anyopaque`
recovered with `@ptrCast(@alignCast(ctx))` [doc for the builtins; pattern
illustrative]. Zig has no exceptions; a C-calling-convention function may only have
C-ABI types, which the compiler enforces ("parameter of type 'Foo' not allowed in
function with calling convention 'x86_64_sysv'" for an enum without a tag type) [doc];
that an error-union return is rejected the same way is [unverified].

**Kotlin/Native.** `staticCFunction(::f)` or a non-capturing lambda; user data via
`StableRef` (dispose when done); "Ensure that the function doesn't throw any
exceptions. Throwing exceptions from a staticCFunction {} causes non-deterministic side
effects" [doc]. Behaviour on threads Kotlin did not create is [unverified].

*(first line from the docs; the `StableRef` line illustrative)*
```kotlin
accept_fun(staticCFunction<Int, Int> { it + 1 })
val ref = StableRef.create(state); register(callback, ref.asCPointer())
```
Source: https://kotlinlang.org/docs/mapping-function-pointers-from-c.html

**Dart FFI.** Four kinds [code `ffi.dart`]: `Pointer.fromFunction` (static functions;
"can only be invoked on the mutator (main) thread of the current isolate. It will abort
the process if invoked on any other thread"); `NativeCallable.isolateLocal` (any
closure, same thread, must be `close`d, keeps the isolate alive); `NativeCallable.
listener` ("can be invoked from any thread", arguments "sent over a SendPort", "only
functions returning void are supported", and "Resources passed to the callback ... must
be valid until the call completes"); `NativeCallable.isolateGroupBound` ("can be invoked
from any thread", runs synchronously in the isolate group, callback "must be trivially
shareable", "an experimental feature"). Exceptions never cross C: "If an exception is
thrown by the callback, the native function will return the exceptionalReturn". After
`close()`, "invoking the nativeFunction from native code will cause undefined
behavior". `keepIsolateAlive` controls whether an open callable keeps the isolate
running.

*(condensed from the `NativeCallable.listener` doc comment)*
```dart
late final NativeCallable<NativeHttpCallback> callback;
callback = NativeCallable<NativeHttpCallback>.listener(onResponse);
nativeHttpGet(uriPointer, callback.nativeFunction);   // onResponse calls callback.close()
```
Source: https://api.dart.dev/dart-ffi/NativeCallable-class.html

**Vala.** A delegate is targeted (closure; the C function gets the user data, by
default last) or `has_target = false`; an `owned` delegate also passes a destroy
notify ("If the method is going to retain a reference to the delegate, then it needs a
helper function to destroy the delegate after it has finished"); positions are set with
`delegate_target_pos` and `destroy_notify_pos`; `[CCode (scope = "async")]` takes GIR's
scope names [doc]. Shared-context delegates need a generics workaround [doc].

```vala
public void call_foo (FooFunc f);              // C: call_foo(foo_func f, void *context)
public void call_foo_later (owned FooFunc f);  // C: + void (*free_context)(void *)
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/07-00-binding-a-c-function-s-parameter-and-return-types/07-05-function-pointers.html

**Nim.** A callback is a `{.cdecl.}` proc type; a Nim closure does not convert
("this will NOT compile because calling conventions differ") [doc]. A `ref` passed as
`pointer` user data is kept alive by hand with `GC_ref`/`GC_unref` [doc system
module; pattern inferred]. A proc type can carry `{.raises: [].}`, which the compiler
checks [doc].

**Vocabularies.** GI `(scope call|async|notified|forever)`: call "Only valid for the
duration of the call", async "Only valid for the duration of the first callback
invocation", notified "valid until the GDestroyNotify argument is called", forever
"valid until the process terminates"; `(closure PARAM)` and `(destroy PARAM)` link the
user data and the destroy function [doc]. Measured use [local]: `async` 1,904,
`notified` 438, explicit `call` 262 (it is the default), `forever` 22; 2,712 closure
links, 345 destroy links. clang `callback(start_routine, arg)` ties a callback to its
argument (used for IPO; "automatically recognized" for `pthread_create`) [doc]; clang
`called_once` exists but is Objective-C only (`LangOpts = [ObjC]`) [code `Attr.td`];
`noescape` on a function-pointer or block parameter [doc]. Threads have no
annotation anywhere surveyed; GIO says it in prose ("invoke callback in the current
thread-default main context", `g_task_new`) [doc docs.gtk.org].

**Best design (recommendation).** The callback's lifetime is part of its type, from
GI's four scopes plus "until unregistered by this token" (signal handlers); the
compiler synthesizes the context pointer and the destroy function and releases the
closure on the scope's event (GI, Vala and nts's `Closure`/`ScopedClosure`/
`OnceClosure` already do this). No exception unwinds through C frames: the bridge
catches, then either ends the program (nts's decision) or returns a binding-declared
exceptional value (Dart's design, the only documented recoverable one); unwinding
through C (Go's panic path) skips C's cleanup. Thread affinity is declared: an
owner-thread callback invoked elsewhere is a fatal error (Dart's `fromFunction`
aborts), and a foreign-thread callback is an asynchronous, void-returning message to the
owner (Dart's `listener`, and nts's `post_from_any_thread`). Re-entrant calls during a
`call`-scope callback are allowed, which requires the runtime to be consistent at every
call into C.

**Pitfalls.**
- Kotlin: exceptions in `staticCFunction` are undefined in effect [doc].
- Dart: `fromFunction` aborts on another thread; `listener` cannot return a value and
  runs later; calling a closed callable is undefined [code].
- C APIs with no user-data slot (`qsort`, `signal`) admit only non-capturing callbacks
  (Kotlin and Go both restrict to these) [doc].
- A callback's user data index wrong in metadata hands C the wrong pointer [inferred
  from GI's `(closure PARAM)` design].

---

## 10. Nullability, and the default when a header says nothing

| Toolchain | How null is typed | Default for an unannotated C pointer | Source |
|---|---|---|---|
| Go cgo | not at all; `nil` is NULL; `C.GoString(nil)` is `""` | unchecked | [doc] cgo |
| Zig | `*T` non-null, `?*T` optional, `[*c]T` allows 0 | translate-c: `[*c]T` ("When a C pointer is coerced to a non-optional pointer, safety-checked Illegal Behavior occurs if the address is 0"); opaque and function pointers `?*T`; nullability qualifiers ignored | [doc] langref "C Pointers"; [code] `Translator.zig` |
| Kotlin/Native | `CPointer<T>` non-null, `CPointer<T>?` nullable | "Pointers and arrays are mapped to CPointer<T>?" | [doc]; whether `_Nonnull` is honoured for C is [unverified] ([secondary] Slack: "by default all the pointers are nullable in cinterop") |
| Dart FFI | `Pointer<T>` is a non-nullable Dart type; NULL is the value `nullptr` | unchecked | [code] `ffi.dart` |
| Vala | `T` versus `T?`; "nullability does not change the C type" for pointer types | non-null in the type, checked "at run-time and partially at compile time" for method arguments; fully only with `--enable-experimental-non-null`; "Vala always assume an out parameter can be null" | [doc] |
| Nim | `ptr T` nullable; `not nil` experimental ("only local symbols are checked") | nullable | [doc] manual_experimental |

*(illustrative)*
```c
#pragma clang assume_nonnull begin
const char *name_of(db *d);                 /* clang 23: 'const char * _Nonnull (db * _Nonnull)' */
const char *_Nullable maybe_name(db *d);    /* only the nullable one needs writing */
#pragma clang assume_nonnull end
```

**Vocabularies.** clang qualifiers `_Nonnull`, `_Nullable`, `_Null_unspecified`,
`_Nullable_result`: `_Nonnull` "does not imply that passing null is undefined
behavior", unlike the `nonnull` attribute [doc]; `#pragma clang assume_nonnull` makes
unannotated pointers `_Nonnull` inside the region [local]; `-Wnullability-completeness`
fires on an included header that annotates some pointers but not others [local];
`-Wnonnull` warns when a literal NULL reaches a `_Nonnull` parameter [local];
`-fsanitize=nullability` is accepted [local]. GCC and clang `nonnull(...)` and
`returns_nonnull`; GCC 15 adds `nonnull_if_nonzero(ptr, count)` [doc]. API notes
`Nullability: N|O|U`, `NullabilityOfRet`, and `Type`/`ResultType` overrides, which clang
23 applies to plain C functions in a module [local]. GI: `(nullable)`, `(not
nullable)`, `(optional)`; everything else is non-nullable, except that "(closure)
parameters and their corresponding user data parameters" and "gpointer parameters and
return types" are "automatically nullable" [doc]. SAL: "By default, annotated pointer
parameters are assumed to be required—they must be non-NULL"; `_opt_` variants allow
NULL [doc]; win32metadata's annotation spec treats `_Inout_` as the semantic default of
an unannotated pointer [doc shift-left spec] and emits `[Optional]` [doc]. Swift, the main
consumer of clang nullability: "If no nullability information is provided for
a type, Swift ... imports the type as an implicitly unwrapped optional", and
"Unannotated declarations within the audited region are treated as nonnullable" [doc
Apple].

**Best design (recommendation).** Three states in the binding, not two: non-null,
nullable, and unknown. Unknown is treated asymmetrically: an unknown *result* is
`T | null`, which forces the check (Kotlin's choice), and an unknown *parameter*
accepts only non-null (passing NULL into unaudited C is the dangerous direction; GI's
and SAL's default). Audited regions (`assume_nonnull`), qualifiers and the override
file move a position from unknown to known. Adopt the completeness rule: once a
declaration annotates any pointer, every pointer in it must be annotated. Never emit
code that relies on non-null for optimization.

**Pitfalls.**
- GCC's `nonnull`: "The compiler may also perform optimizations based on the
  knowledge that certain function arguments cannot be null", and in definitions this
  "can currently not be disabled other than by removing the nonnull attribute" [doc].
- `memcpy(NULL, NULL, 0)` was undefined until C2y (N3322); glibc still marks
  `memcpy` nonnull [doc; local].
- Vala's nullable outs against C that dereferences them (section 6) [doc].
- The API notes `NullabilityOfRet` bug (section 1) [doc].

---

## 11. Enums, flags, constants, macros and `static inline` functions

**Go cgo.** `C.enum_x` names the type; enumerators, simple `#define`s (integer, float
and string constants) are found with `gcc -E -dM` and compile probes such as `enum {
__cgo_undefined__3 = (foo)*1 }` [doc]. A `static` function in the preamble is callable,
which is how the docs wrap a variadic call; the same works for a function-like macro
[inferred]. Names beginning
`struct_`, `union_`, `enum_` or `sizeof_` cannot be referenced directly ("A workaround
is to use a #define in the preamble") [doc].

**Zig.** A C enum becomes an integer type alias, `pub const enum_FOO = c_uint;` (or
`u8` under `-fshort-enums`) [doc], with its enumerators as constants [unverified
detail]. Object-like macros become constants;
function-like macros are translated when possible, and what cannot be translated is
"demoted" to `@compileError`, which "will not cause a compile error in your code unless
you actually use them" [doc]. `static inline` bodies are translated when `func_bodies`
is set [code].

**Kotlin/Native.** "Enums can be mapped to either Kotlin enum or integral values,
depending on heuristics and the definition file settings" (`strictEnums`,
`nonStrictEnums`); "Every C macro that expands to a constant is represented as a Kotlin
property"; function-like macros are exposed through custom declarations in the `.def`
[doc].

```
headers = library/base.h
---
static inline int foo(int arg) { return FOO(arg); }
```
Source: https://kotlinlang.org/docs/native-c-interop.html#macros

**Dart FFI.** Since ffigen 13.0.0 "Native enums are now generated as real Dart enums"
(opt out with `as-int`); "Enum integer types are implementation-defined and not part of
the ABI"; macros and unnamed enums become top-level constants (since 0.1.5) [doc
changelog]. ffigen 2.0.0-dev.6 began skipping `inline` functions and 9.0.1 allowed
"extern inline functions to be generated" [doc changelog]; a `static inline` function
has no symbol to look up [inferred].

**Vala.** `[CCode (cname = "foo_e", cprefix = "FOO_")] public enum Foo { A, B }`;
`[Flags]` for bit masks; a `#define` group can be bound as an enum with `cname =
"int"`; constants bind the identifier, not the value: "Vala will use the identifier in
the generated C code and then the C pre-processor will replace it" [doc].

```vala
[CCode (cname = "int", cprefix = "FOO_", has_type_id = false)] [Flags]
public enum Foo { READ, WRITE, CREATE }
public const double CUSTOM_PI;
```
Source: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually/04-00-recognizing-vala-semantics-in-c-code/04-02-enums-and-flags.html

**Nim.** `let cconst {.importc, nodecl.}: cint` imports a C constant [doc]. Because
the C backend emits the call text, an `importc` proc can name a function-like macro
[inferred; not stated in the manual].

**Vocabularies.** clang `flag_enum` and `enum_extensibility(open|closed)` are accepted
in C and recorded in the AST [local] (10 and 3 headers use them here [local]); GI
distinguishes `<enumeration>` (1,791 here), `<bitfield>` (501), `<constant>` (7,431)
and records 8,879 `<function-macro>` entries that are not callable [local];
win32metadata lifts `#define` groups into enums from `enums.json`, scrapes constants
"as raw text (line-by-line regex)", and marks "Inline functions that return constants"
with `[Constant]` so "Projections need to implement these functions themselves"; it
also has `[ScopedEnum]`, `[AssociatedEnum]`, `[AssociatedConstant]` [doc]; API notes
`EnumKind: NSEnum|CFEnum|NSClosedEnum|CFClosedEnum|NSOptions|CFOptions|none` [doc].

**Best design (recommendation).** A compiler that emits C (as nts does) binds
function-like macros and `static inline` functions best through a generated C shim
compiled against the header, the cgo-preamble and Kotlin-`.def` technique: exact
semantics, nothing re-implemented, and the witness checks it like any other binding;
the LLVM backend compiles the same shim with clang. Constants are evaluated by the C
compiler (cgo's probes), never by text scraping. Enums are open integer-backed types
with named members (C enums are open; Zig's translation), flags are bit sets, and an
enum is closed only when `enum_extensibility(closed)` or the override file says so;
the storage type comes from the compiler for the target.

**Pitfalls.**
- Dart's closed enums over open C enums: what happens to a value outside the enum is
  [unverified].
- Vala: an enum with aliases makes the default `to_string ()` fail with "the C error
  duplicate case" [doc].
- `-fshort-enums` and target differences change an enum's width (Zig doc) [doc].
- Regex-scraped constants (win32metadata's ConstantsScraper) miss what the
  preprocessor would compute [doc describes the method; consequence inferred].

---

## 12. Variadic functions

**Go cgo.** "Calling variadic C functions is not supported. It is possible to
circumvent this by using a C function wrapper" [doc].

*(from the cgo docs)*
```go
// static void myprint(char* s) { printf("%s\n", s); }
import "C"
```

**Zig.** "Zig supports extern variadic functions"; Zig can also define them with
`@cVaStart`/`@cVaArg`/`@cVaEnd`, with documented target exceptions (aarch64 non-macOS,
x86_64 Windows, s390x tests skipped) [doc].

```zig
pub extern "c" fn printf(format: [*:0]const u8, ...) c_int;
```

**Kotlin/Native.** Generated bindings take `vararg variadicArguments: Any?`; argument
types are fixed at the call site, a Kotlin `vararg` cannot be forwarded, and `va_list`
functions have "no official support" (KT-56164) [secondary: Kotlin Slack threads].

**Dart FFI.** `VarArgs<(Int, Double)>` in the native signature, one binding per shape:
"When a variadic function is called with different variadic argument types, multiple
bindings need to be created"; "VarArgs must be the last parameter" (Dart 3.0) [code];
ffigen's `functions -> variadic-arguments` lists the shapes [doc changelog].

```dart
typedef NativePrintfIntDouble = Int Function(Pointer<Char>, VarArgs<(Int, Double)>);
```

**Vala.** `...` with `sentinel = "NULL"` appended automatically, and `[PrintfFormat]`/
`[ScanfFormat]` type checks; "Return values that append to the end of a function, such
as array length returns, and delegate contexts, will often interact badly with variadic
arguments ... it is best to specify all positions explicitly" [doc].

**Nim.** `{.varargs.}`; "Nim string values will be converted to C strings
automatically" [doc].

**Vocabularies.** `format(printf, m, n)` and `sentinel` (GCC and clang) [local];
SAL `_Printf_format_string_` [doc]; GI marks varargs callables not introspectable
(825 varargs parameters here) [local]; win32metadata ends a variadic function with
`__arglist` [doc]. ABI: on Apple arm64 "Assign the variadic argument to the
appropriate number of 8-byte stack slots", so a variadic callee cannot be called
through a non-variadic prototype [doc Apple].

**Best design (recommendation).** The binding states the types of each call shape
(Dart's `VarArgs`, nts's typed rest parameter, Kotlin's call-site fixing). A compiler
that emits C emits an ordinary call through the real variadic prototype, each argument
cast to its stated, promoted type, so the C compiler applies the platform's variadic
ABI (Apple arm64 included). Check `printf`-style formats against literal format strings
when the header carries `format`; refuse forwarding a dynamic argument list (no
`va_list` construction); bind the `v*` variant when one is needed.

**Pitfalls.** Go has no support [doc]; Apple arm64's stack-slot rule [doc]; Vala's
misplaced generated parameters [doc]; a user string as the format is the classic
format-string bug (CWE-134) [unverified citation].

---

## 13. Safety checking: static, dynamic, none, and the escape hatch

| Toolchain | Checked statically | Checked dynamically | Not checked | Escape hatch |
|---|---|---|---|---|
| Go cgo | `go vet` cgocall: chan/map/func/slice passed to C [code] | `cgocheck=1` cheap checks by default; `GOEXPERIMENT=cgocheck2` complete pointer checks; `#cgo nocallback` violations panic [doc] | what C does: "there is nothing stopping the C code from doing anything it likes" [doc] | `unsafe.Pointer`; "It is possible to defeat this enforcement by using the unsafe package" [doc] |
| Zig | pointer kinds (`*T`, `?*T`, `[*]T`, `[*:0]T`, `[*c]T`); C-ABI types in `callconv(.c)` functions [doc] | safety-checked Illegal Behavior in Debug/ReleaseSafe: null coercion of `[*c]T`, slice bounds [doc] | ReleaseFast and ReleaseSmall: "Safety checks disabled" [doc build modes] | `@ptrCast`, `@ptrFromInt`, `[*c]T`, `allowzero` [doc] |
| Kotlin/Native | opt-in: every cinterop declaration needs `@ExperimentalForeignApi`; `CPointer<T>` versus `CPointer<T>?` [doc] | null only (`!!` on a `CPointer<T>?`); `CPointer` indexing has no length to check [doc; inferred] | `.reinterpret` "unsafe and can potentially lead to subtle memory problems" [doc] | `reinterpret`, `toLong()`/`toCPointer()` [doc] |
| Dart FFI | `.address` only as a whole argument of a leaf call; `Finalizable` liveness [code] | thread checks abort (`fromFunction`); `Arena` throws `StateError` after release [code] | `Pointer.cast` "is completely unchecked"; a leaf function must not call back into Dart (a rule, not a check) [code] | `Pointer.fromAddress`, `cast()` [code] |
| Vala | ownership (`owned`/`unowned`, `(owned)` transfer); non-null with the experimental flag [doc] | argument null checks in Vala-defined methods [doc] | the VAPI itself: "If ownership semantics are not correct, either a memory leak has been written or a double-free has been written" [doc] | pointer types `Foo*`, `delete`, casts [doc] |
| Nim | effect system (`raises`), `=copy {.error.}`, `lent` ("proven by the compiler that the pointer does not outlive its origin") [doc] | bounds checks on Nim arrays and seqs [unverified wording] | `cstring` indexing: "no bounds checking for cstring is performed" [doc] | `ptr`, `cast`, `addr`, `{.emit.}` [doc] |

**Vocabularies.** clang: `counted_by` feeds "the array bound sanitizer and the
`__builtin_dynamic_object_size` builtin" (clang 18) [doc]; clang 23 adds
`-Wlifetime-safety` ("a CFG-based intra-procedural analysis that detects use-after-free
and related temporal safety bugs"), `-Wlifetime-safety-noescape` and
`-Wlifetime-safety-suggestions` [doc]; the Static Analyzer reads the ownership
attributes [doc]; full `-fbounds-safety` (traps, wide pointers, `__single` by default
for ABI-visible pointers) exists only in Apple's fork [doc, local]. GCC: `-fanalyzer`
uses `fd_arg`, `null_terminated_string_arg`, the deallocator pairing
(`-Wmismatched-dealloc`) and `access` (`-Wstringop-overflow`) [doc]. SAL is checked by
Microsoft's code analysis ("the analyzer reports an error if the pointer is null") [doc].

**Best design (recommendation).** Static first: every semantic fact is a type-level
brand checked by the compiler (nts's vocabulary already carries most), with ownership
and escape checked by an analysis (ResourceFlow), the way Nim, Vala and Dart check
their pieces. Dynamic checks only where the fact is a runtime value: counts against
buffer lengths and shared counts (Swift's safe overloads trap), nulls in unknown
results, thread affinity. One escape hatch, named and greppable (raw `Ptr`/`Opaque`
whose uses are "the caller's obligation"), and every claim the compiler believes
without proof (`noescape`, `Declared<T, D>`) marked as a trust boundary and, where a
header annotation exists for the same fact, cross-checked against it (refuse a
contradiction).

**Pitfalls.** A false `noescape` is undefined behaviour [doc]; `nonnull` lets the
optimizer delete checks [doc]; cgocheck=1 is partial [doc]; Kotlin's blanket opt-in on
every declaration makes the unsafe marker carry no signal [inferred]; a wrong VAPI is
silent until valgrind [doc].

---

# Part B. Annotation vocabularies: status, expressiveness, use

Use counts come from this machine: 25,244 `.h` files under `/usr/include` and the 131
GIR files under `/usr/share/gir-1.0` (scripts `scratch-b/scripts/hdrstats.sh`,
`girstats.py`, `girstats2.py`). They show which spellings real Linux libraries ship,
not world-wide frequency.

## B1. clang bounds annotations (`-fbounds-safety` family)

What it can say: `__counted_by(N)` (N elements), `__sized_by(N)` (N bytes),
`__counted_by_or_null`/`__sized_by_or_null` (null allowed whatever N says),
`__ended_by(P)` (range end), `__null_terminated`/`__terminated_by(T)`, `__single`
(one object or null; the default for ABI-visible pointers), `__indexable`/
`__bidi_indexable` (wide pointers), `__unsafe_indexable` (plain C pointer) [doc
BoundsSafety.rst].

**Upstream status [doc, local].**

| Feature | Upstream clang | Flag |
|---|---|---|
| `counted_by` on a flexible array member | clang 18 ("Clang now supports the C-only attribute counted_by") | none; C only (in C++ "ignored") |
| `counted_by` on pointer struct fields; `sized_by`, `counted_by_or_null`, `sized_by_or_null` | clang 19 | none; C only |
| count field declared after the pointer | clang 19 | `-fexperimental-late-parse-attributes`, and "only when attribute is used in the declaration attribute position" (clang 23 with the flag: `int *p __attribute__((counted_by(n))); size_t n;` accepted; the type-position form `int *__attribute__((counted_by(n))) p` still "use of undeclared identifier") |
| `__builtin_counted_by_ref` | clang 20 | none |
| `counted_by`/`sized_by` on function parameters and returns | **not in clang 23.1.3, nor in `main` (Oct 2026)**: "'counted_by' attribute only applies to non-static data members", also with `-Xclang -fexperimental-bounds-safety` | - |
| `ended_by`, `__single`, `__terminated_by`, wide pointers, the `ptrcheck.h` macros | not upstream: "unknown attribute ... ignored"; no `ptrcheck.h` in clang 23's resource headers | - |
| `-fexperimental-bounds-safety` | a cc1 flag (`-Xclang ...`); the driver rejects it | the docs: "Not fully implemented upstream"; the full model is "available here in a fork" (`swiftlang/llvm-project`, `stable/20240723`) |
| API notes `BoundsSafety: {Kind, BoundedBy, Level}` on a parameter | parsed by clang 23's YAML reader (`APINotesYAMLCompiler.cpp`), **not applied** (no `__counted_by` in the AST, with or without the experimental flag) | `-fapinotes-modules` |

The `clang/Basic/Attr.td` of `release/23.x` and of `main` both declare `CountedBy`
with `Subjects = SubjectList<[Field], ErrorDiag>` and `LangOpts = [COnly]` [code].
GCC: `counted_by` on a flexible array member is GCC 15 (PR108896, target milestone
15.0) and on pointer members GCC 16 ("The counted_by attribute supports members of
pointer type"); GCC 16.2.1 here ignores `sized_by`/`*_or_null` and rejects
`counted_by` on a parameter [doc, local]. Consumers: clang's UBSan bounds and
`__builtin_dynamic_object_size` [doc]; Swift 6.2's experimental `SafeInteropWrappers`
on parameters with Apple's clang [doc].

Concepts: 4 (yes, fields upstream; parameters fork-only), 5 (fork-only), 10 (the
`_or_null` forms), 13 (yes), 2 (flexible array counts).

Use here: `counted_by` in 11 headers, almost all Linux uapi, where userspace gets an
empty macro (`#define __counted_by(m)`); `sized_by` in 1; `ended_by` and
`__null_terminated` in none [local]. The Linux kernel is the major adopter (see the
CVE in section 4).

## B2. clang `noescape`, `lifetimebound`, `lifetime_capture_by`

- `noescape` (parameter): the pointer "cannot escape", misuse "leads to undefined
  behavior"; clang 23: "now disallows deallocating memory through the annotated
  parameter" (not yet used by the optimizer) and adds `-Wlifetime-safety-noescape`
  [doc]. Concepts 3, 9, 13.
- `lifetimebound` (parameter or implicit `this`): the result may refer to what the
  parameter refers to; clang 20 made it an error on a `void` function or in a type
  position [doc]. Works in C with clang 23 (local test above). Concepts 5, 8 (a
  borrowed handle tied to its parent), 13.
- `lifetime_capture_by(X)` (clang 20): the parameter is stored into `X` (another
  parameter, `this`, `global`, `unknown`); accepted on a C parameter by clang 23
  [doc, local]. Concept 3 (retention), 9.

Use here: `noescape` in 7 headers (xxHash's `XXH_NOESCAPE` macro 101 times);
`lifetimebound` in 12, all C++ (absl, fmt, simdjson, mozjs, and clang/LLVM's own);
`lifetime_capture_by` in 4 (absl, mozjs, clang's own) [local]. No C library here uses
the lifetime attributes.

## B3. clang nullability

`_Nonnull`, `_Nullable`, `_Null_unspecified`, `_Nullable_result`,
`#pragma clang assume_nonnull begin/end`, plus the GCC-compatible `nonnull` and
`returns_nonnull` attributes [doc]. Qualifiers sit in the type, so they can say "a
nullable pointer to an array of nonnull pointers" [doc]. Concepts 10, 6 (each pointer
level of an out parameter), 13 (`-Wnonnull`, `-Wnullability-completeness`,
`-fsanitize=nullability`).

Use here: raw `_Nullable` in 9 headers and `_Nonnull` in 8, but libraries wrap them
in macros gated on `__clang__`: `LILV_NONNULL` 213 and `LILV_NULLABLE` 127 uses,
`SERD_*` 177/124, `ZIX_*` 133/83, libzip 134 raw uses; `assume_nonnull` in 3 headers;
glibc's `__nonnull` 740 uses in 51 headers and the raw attribute 479 in 103 [local].
Apple's SDK headers are the large adopter (Swift imports them) [doc Apple; size
unverified].

## B4. clang `ownership_returns`, `ownership_takes`, `ownership_holds`

Static-Analyzer-only allocation kinds: `ownership_returns(kind[, size-index])`,
`ownership_takes(kind, index)` (deallocates), `ownership_holds(kind, index)` (takes
over and frees later; using it afterwards is legitimate, releasing it is "an attempt
to release non-owned memory"); acknowledged only with
`unix.DynamicMemoryModeling:Optimistic=true` [doc]. The clang 22 and 23 release notes
record analyzer crash fixes for functions carrying both `ownership_returns` and
`ownership_takes` (#GH183344) and for mismatched `ownership_returns` (#GH188733) [doc]. Recorded in
the AST as `OwnershipAttr` in C [local]. Concepts 8, 3 (holds = retention). Use here:
0 headers [local].

## B5. `swift_attr`

A free-form string: "This kind of annotation is ignored by Clang as it doesn't have
any semantic meaning in languages supported by Clang. The Swift compiler can interpret
these annotations according to its own rules" [doc]; clang's API notes page names
`swift_attr("returns_retained")` and `swift_attr("returns_unretained")` as the
attribute forms of `SwiftReturnOwnership` [doc]. It is a transport, not a vocabulary:
its meaning is Swift's (the full list of strings Swift accepts is [unverified]). Use
here: 1 header [local].

## B6. API notes (`.apinotes`)

A YAML side file named after a clang module, found "relative to the module map" with
`-fapinotes-modules`; "cannot be used to modify arbitrary textual headers" [doc]. Keys
(clang 23): `Nullability`, `NullabilityOfRet`, `Type`, `ResultType`, `Parameters`
(by 0-based `Position`, with `Nullability`, `NoEscape`, `Type`, and, in the YAML
reader, `Lifetimebound` and `BoundsSafety`), `SwiftName`, `SwiftPrivate`,
`Availability`, `SwiftImportAs` (`owned`, `reference`, `opaque_pointer`), `SwiftRetainOp`/
`SwiftReleaseOp`, `SwiftCopyable` with `SwiftDestroyOp`, `SwiftReturnOwnership`,
`SwiftSafety`, `EnumKind`, `NSErrorDomain`, `SwiftWrapper`, `DesignatedInit`
[doc, code]. Verified with clang 23 on a plain C module: `Nullability`, `ResultType`,
`Type`, `NoEscape` and `Lifetimebound` are applied to the AST; `BoundsSafety` is parsed
but not applied [local]. Concepts 1 (yes), 3 (`NoEscape`), 5 (`Lifetimebound`), 8
(Swift ownership keys), 10 (yes), 11 (`EnumKind`), 4 (fork-only in effect).

Use: none on this machine; Swift ships API notes for non-Apple libc modules
(`_stdio.apinotes`: `__sFILE` as `opaque_pointer`; `posix_filesystem.apinotes` fixes
`fts_open`'s parameter to `char * const _Nullable * _Nonnull`) and for `WinSDK`,
`vcruntime`, WASI [code swiftlang/swift `stdlib/public/Platform`].

## B7. clang handle attributes (Fuchsia)

`acquire_handle("tag")` on a result or out parameter, `use_handle("tag")`,
`release_handle("tag")` on parameters [doc]; accepted on C integer handles by clang 23
[local]. Concept 8 (and file descriptors). Use here: 0 headers [local].

## B8. GCC `access`, `malloc (deallocator)` and relatives

- `access (read_only|read_write|write_only|none, ref-index[, size-index])`: size in
  elements, or bytes for `void *` [doc]. **clang 23: unknown attribute, dropped;
  `__has_attribute(access)` is 0** [local]. glibc wraps it as `__attr_access` (140
  uses in 26 headers) and drops it for `_FORTIFY_SOURCE=3` because "we use
  __builtin_dynamic_object_size, which may use the access attribute ... so we can't use
  them on functions we fortify" [code `sys/cdefs.h`]. Concepts 4, 6.
- `malloc (deallocator[, ptr-index])` (GCC 11): pairs an allocator with its
  deallocator for `-Wmismatched-dealloc`; the plain and the argument forms are both
  needed "to indicate that an allocation function both satisfies the nonaliasing
  property and has a deallocator" [doc]. **clang 21 turned the former error into a
  warning; clang 23 warns "'malloc' attribute ignored because Clang does not yet
  support this attribute signature" yet keeps the deallocator and index in the AST**
  (`RestrictAttr malloc 1` with a `DeclRefExpr`), and its documentation says the
  warning `-Wmismatched-dealloc` "is not yet implemented in clang" [doc, local]. glibc
  emits it (`__attr_dealloc`, 17 uses in 10 headers) only for `__GNUC_PREREQ (11, 0)`,
  so clang sees it only with `-fgnuc-version=11` or later [local]. Concept 8.
- `nonnull_if_nonzero (ptr, count[, count2])` (GCC 15),
  `null_terminated_string_arg (N)`, `fd_arg (N)`/`fd_arg_read`/`fd_arg_write`
  (analyzer): all **unknown to clang 23** [doc, local], and used by 0 headers here
  [local]. Concepts 10/4, 5, 8.

## B9. Microsoft SAL and win32metadata

SAL (MSVC code analysis): `_In_`, `_Out_`, `_Inout_`, `_In_z_`, `_In_reads_(s)`,
`_In_reads_bytes_(s)`, `_Out_writes_(s)`, `_Out_writes_to_(s,c)`, `_Inout_updates_(s)`,
`_In_reads_to_ptr_(p)`, the `_opt_` forms, `_Outptr_` and its `_result_maybenull_`,
`_result_nullonfailure_`, `_COM_` and `_buffer_` forms, `_Outref_`, `_Ret_z_`,
`_Ret_maybenull_`, `_Ret_writes_(s)`, `_Printf_format_string_`, and the behaviour
annotations `_Success_`, `_On_failure_`, `_Always_`, `_Return_type_success_`,
`_Check_return_`, `_Must_inspect_result_` [doc], and `_Post_ptr_invalid_` for a
pointer a function frees ("e.g. void free( _Post_ptr_invalid_ void* pv );") [code
CoreCLR's copy of `sal.h`]. It states pre-state and post-state validity separately
(GCC `access` comes closest, with its "must be initialized" and "need not be
initialized" modes). Concepts 4, 5, 6, 7, 10, 12, 13, and 8 in part; not 3 or 9.

win32metadata turns the Windows SDK headers into an ECMA-335 `Windows.Win32.winmd`:
ClangSharp parses the headers and "preserves [SAL] as [NativeAnnotation] attributes
(v18+)", a regex `ConstantsScraper` reads `#define`s, and sidecar files add what headers
lack (`autoTypes.json` handles, `WithSetLastError.rsp`, `enums.json`,
`emitter.settings.rsp`, `supportedOS.rsp`, `libMappings.rsp`); new facts travel through
the header as `__attribute__((annotate("w32m:...")))` (for example
`_Win32_RAIIFree_(CloseHandle, 0, INVALID_HANDLE_VALUE)`) [doc]. Its attributes:
`[In]`, `[Out]`, `[Optional]`, `[Reserved]`, `[RetVal]`, `[ComOutPtr]`,
`[NativeArrayInfo]`, `[MemorySize]`, `[Retained]`, `[FreeWith]`, `[DoNotRelease]`,
`[IgnoreIfReturn]`, `[CanReturnMultipleSuccessValues]`, `[CanReturnErrorsAsSuccess]`,
`SetLastError`, `[StructSizeField]`, `[NativeBitfield]`, `[FlexibleArray]`,
`[ScopedEnum]`, `[AssociatedEnum]`, `[AssociatedConstant]`, `[NativeTypedef]` with
`RAIIFree`/`InvalidHandleValue`/`AlsoUsableFor`, `[Const]`, `[Constant]`, `[Ansi]`/
`[Unicode]`, `[NativeEncoding]`, `[NotNullTerminated]`, `[Agile]`,
`[SupportedArchitecture]`, `[Documentation]` [doc projections.md]. Concepts 1-8, 10,
11, 12 (`__arglist`); callbacks only as delegate types.

Use: the whole Windows SDK; consumers include windows-rs, CsWin32, zigwin32 and the
win32json translation [doc repos]. On this Linux machine SAL appears in 1 header
[local].

## B10. GObject Introspection

Annotations in gtk-doc comments are scanned into GIR XML [doc]: `(transfer
none|container|full|floating)`, `(in)`, `(out)`, `(out caller-allocates)`,
`(out callee-allocates)`, `(inout)`, `(nullable)`, `(not nullable)`, `(optional)`,
`(not optional)` (1.80), `(array length=P|fixed-size=N|zero-terminated=1)`,
`(element-type T)`, `(type T)`, `(scope call|async|notified|forever)`,
`(closure P)`, `(destroy P)`, `(skip)`, `(rename-to)`, `(constructor)`, `(method)`,
`(ref-func)`/`(unref-func)`/`(copy-func)`/`(free-func)` (1.76), `(value)`,
`(attributes ...)`; a trailing `GError **` becomes `throws` [doc]. Defaults: in
parameters `transfer none`, out and inout `transfer full` (none if caller-allocates),
returns `transfer full`, with `const gchar*` meaning none [doc]. Concepts 1-11 and 12
(varargs are not introspectable); not 13.

Use in the 131 local GIR files [local]: 53,497 callables with 71,300 parameters;
in parameters transfer none 62,083, full 772, container 7; out full 6,155, none 1,974;
returns none 43,643, full 9,187, container 236 (the transfer attribute is written for
defaults too); nullable 12,507 parameters and 4,303 returns, optional 5,416, legacy
allow-none 17,533; 2,368 array parameters (1,044 with a length parameter, 81
fixed-size); 836 caller-allocates; 7,481 throwing callables; scopes and closures as in
section 9; 825 varargs parameters; 1,791 enumerations, 501 bitfields, 7,431 constants,
8,879 function-macros; 14,881 elements marked not introspectable. In headers, `(transfer
...)` appears in 166 files [local], since most annotations live in the `.c` sources.

## B11. Coverage matrix

Y: expresses it; P: partly; -: no. Upstream status in parentheses where it matters.

| Vocabulary | 1 src | 2 layout | 3 retain | 4 buffers | 5 strings | 6 outs | 7 errors | 8 handles | 9 callbacks | 10 null | 11 enums | 12 varargs | 13 checks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| clang bounds (fields upstream, params fork) | header | P | - | Y (P upstream) | P (fork) | - | - | - | - | P | - | - | Y |
| clang noescape / lifetimebound / capture_by | header | - | Y | - | Y (borrowed results) | - | - | P | Y | - | - | - | P |
| clang nullability | header | - | - | - | - | P | - | - | - | Y | - | - | P |
| clang ownership_* | header | - | P | - | - | - | - | Y (analyzer) | - | - | - | - | P |
| clang handle attrs | header | - | - | - | - | P | - | Y | - | - | - | - | P |
| clang flag_enum / enum_extensibility / format / sentinel / callback | header | - | - | - | - | - | - | - | P | - | Y | Y | P |
| API notes | side file | - | Y | P (parsed only) | P | - | P (ObjC) | Y (Swift keys) | P | Y | P | - | - |
| GCC access | header (clang drops) | - | - | Y | - | P | - | - | - | - | - | - | P |
| GCC malloc(dealloc) | header (clang AST only, no checks) | - | - | - | - | - | - | Y | - | - | - | - | P |
| GCC nonnull_if_nonzero / null_terminated_string_arg / fd_arg | header (GCC only) | - | - | P | Y | - | - | P (fds) | - | Y | - | - | P |
| SAL | header (MSVC) | - | - | Y | Y | Y | Y | P (`_Post_ptr_invalid_`) | - | Y | - | P | Y (MSVC) |
| win32metadata | winmd + sidecars | Y | P | Y | Y | Y | Y | Y | P | Y | Y | P | - |
| GObject Introspection | GIR (from doc comments) | P | Y | Y | Y | Y | Y | Y | Y | Y | Y | - | - |

---

# Part C. What this means for nts

nts has decided (read in `~/Projects/nts/docs/targets/c-headers.md` and
`docs/targets/native.md`): `bind-c` reads clang's JSON AST and record layouts; a
witness compiles every binding against the real headers; whole-header binding with an
override file comes after ResourceFlow; "Clang's own annotations are read where a header
has them (`_Nullable`, `_Nonnull`, `counted_by`, `malloc` and the ownership
attributes)"; macros and `static inline` functions are open (proposed: a C shim); the
override file's form is open (proposed: TypeScript); variadics beyond typed rest
parameters are open. The survey bears on each:

1. **Reading clang's annotations needs three adjustments [local].** (a) `counted_by` is
   field-only upstream, so parameter counts must come from the override file (or from
   API notes YAML read directly, since clang parses `BoundsSafety` but does not apply
   it). (b) glibc emits `malloc(deallocator)` only for GCC 11+; clang 23 keeps it in the
   AST when it is emitted, so either parse with `-fgnuc-version=11` or later (a change
   to every glibc code path, untested here beyond `stdio.h` and `unistd.h`) or state
   glibc's deallocators in the override file. GCC `access` never reaches clang's AST.
   (c) Predefine annotation macros that headers blank for portability
   (`-D'__counted_by(m)=__attribute__((counted_by(m)))'` recovered uapi counts).
   `ownership_*` has no users on this machine; `_Nonnull`/`_Nullable` arrive through
   clang-gated library macros, and `assume_nonnull` regions must be honoured.
2. **The override file.** Vala's VAPI (language-native declarations) layered over GIR
   with `.metadata` fixes is the precedent closest to nts's proposal of a typed
   TypeScript file; win32metadata and API notes show the same three layers (header,
   curated metadata, per-symbol overrides). Accepting GIR (already `bind-gir`) and API
   notes as inputs costs a translator each.
3. **Facts the current vocabulary lacks, by the comparison** [inferred]: retention of
   a buffer until an event (SQLite `SQLITE_STATIC`, win32 `[Retained]`); borrowed
   results tied to a parent and invalidated by named calls (`sqlite3_column_text`,
   `sqlite3_errmsg`); a dependent handle's reference to its parent; optional-versus-
   nullable for out slots; outputs invalid on failure; GI's `forever` scope; foreign-
   thread callbacks as asynchronous messages (nts's `post_from_any_thread` matches
   Dart's `listener`); struct size fields (`StructSizeField`).
4. **Macros and `static inline`.** A C shim compiled against the header is the
   approach of cgo (preamble) and Kotlin (`.def` custom declarations); Zig translates
   bodies instead, which nts does not need because it emits C.
5. **Variadics.** Typed shapes plus an ordinary C call through the real prototype is
   ABI-correct on Apple arm64, where variadic arguments go to stack slots.

---

# Sources

Toolchains
- Go: https://pkg.go.dev/cmd/cgo (source https://github.com/golang/go/blob/master/src/cmd/cgo/doc.go);
  https://pkg.go.dev/runtime#Pinner; https://pkg.go.dev/runtime/cgo#Handle;
  https://pkg.go.dev/runtime#AddCleanup; https://pkg.go.dev/runtime#KeepAlive;
  https://go.dev/doc/go1.17, https://go.dev/doc/go1.21, https://go.dev/doc/go1.24,
  https://go.dev/doc/go1.25, https://go.dev/doc/go1.26, https://go.dev/doc/go1.27;
  https://github.com/golang/go/blob/master/src/runtime/cgocall.go;
  https://github.com/golang/go/blob/master/src/runtime/proc.go;
  https://pkg.go.dev/golang.org/x/tools/go/analysis/passes/cgocall; https://go.dev/wiki/cgo;
  https://osv.dev/vulnerability/CVE-2023-29404, https://osv.dev/vulnerability/CVE-2023-29402,
  https://osv.dev/vulnerability/CVE-2023-39323
- Zig: https://ziglang.org/documentation/0.17.0/ (sections C, C Pointers, C Translation
  CLI, Translation failures, C Variadic Functions, extern struct, extern enum, opaque,
  defer, errdefer, Sentinel-Terminated Pointers, Slices, Build Mode);
  https://ziglang.org/download/0.16.0/release-notes.html;
  https://ziglang.org/download/0.17.0/release-notes.html;
  https://codeberg.org/ziglang/translate-c (README, src/Translator.zig, src/MacroTranslator.zig);
  https://codeberg.org/ziglang/zig/src/tag/0.17.0/lib/std/posix.zig
- Kotlin/Native: https://kotlinlang.org/docs/native-c-interop.html;
  https://kotlinlang.org/docs/native-definition-file.html;
  https://kotlinlang.org/docs/mapping-function-pointers-from-c.html;
  https://kotlinlang.org/docs/mapping-strings-from-c.html;
  https://kotlinlang.org/docs/native-memory-manager.html;
  https://github.com/JetBrains/kotlin/blob/master/kotlin-native/runtime/src/main/kotlin/kotlin/native/ref/Cleaner.kt;
  secondary: https://slack-chats.kotlinlang.org/t/527276/when-calling-variadic-c-functions-spread-operator-is-support,
  https://slack-chats.kotlinlang.org/t/529062/are-there-platform-types-in-kotlin-native
- Dart: https://dart.dev/interop/c-interop; https://github.com/dart-lang/sdk/blob/main/sdk/lib/ffi/ffi.dart,
  .../native_finalizer.dart, .../native_type.dart, .../struct.dart (published as
  https://api.dart.dev/dart-ffi/dart-ffi-library.html);
  https://github.com/dart-lang/native/blob/main/pkgs/ffi/lib/src/arena.dart, .../utf8.dart;
  https://github.com/dart-lang/native/tree/main/pkgs/ffigen (README, CHANGELOG);
  https://pub.dev/packages/ffigen; secondary: https://github.com/dart-lang/sdk/issues/38832
- Vala: https://docs.vala.dev/guides/bindings/writing-a-vapi-manually.html and subpages
  (sources https://github.com/vala-lang/vala-docs);
  https://docs.vala.dev/guides/bindings/generating-a-vapi-with-gobject-introspection.html;
  https://docs.vala.dev/guides/memory-management.html;
  https://docs.vala.dev/tutorials/main/04-00-advanced-features/04-02-error-handling.html;
  https://docs.vala.dev/tutorials/main/05-00-experimental-features/05-03-strict-non-null-mode.html;
  https://gnome.pages.gitlab.gnome.org/vala/manual/attributes.html;
  https://gitlab.gnome.org/GNOME/vala/-/blob/main/vapi/sqlite3.vapi;
  https://gitlab.gnome.org/GNOME/vala/-/blob/main/codegen/valaccodebasemodule.vala;
  local `/usr/share/vala/vapi/atasmart.vapi`
- Nim: https://nim-lang.org/docs/manual.html (Foreign function interface, cstring type,
  Effect system); https://nim-lang.org/docs/destructors.html;
  https://nim-lang.org/docs/mm.html; https://nim-lang.org/docs/manual_experimental.html
  (Not nil annotation, Quirky routines); https://nim-lang.org/docs/system.html (GC_ref);
  https://github.com/nim-lang/c2nim; https://github.com/PMunch/futhark

Vocabularies
- clang: https://clang.llvm.org/docs/AttributeReference.html (counted_by, sized_by,
  noescape, lifetimebound, lifetime_capture_by, nullability, ownership_*, swift_attr,
  malloc, malloc_span, acquire_handle, callback, flag_enum, enum_extensibility);
  https://github.com/llvm/llvm-project/blob/release/23.x/clang/include/clang/Basic/Attr.td;
  https://clang.llvm.org/docs/BoundsSafety.html, https://clang.llvm.org/docs/BoundsSafetyImplPlans.html,
  https://clang.llvm.org/docs/BoundsSafetyAdoptionGuide.html;
  https://clang.llvm.org/docs/APINotes.html;
  https://github.com/llvm/llvm-project/blob/release/23.x/clang/lib/APINotes/APINotesYAMLCompiler.cpp;
  release notes: https://github.com/llvm/llvm-project/blob/release/18.x/clang/docs/ReleaseNotes.rst
  (and release/19.x, 20.x, 21.x, 22.x `.rst`; release/23.x and main `ReleaseNotes.md`);
  https://github.com/swiftlang/llvm-project/tree/stable/20240723
- GCC: https://gcc.gnu.org/onlinedocs/gcc/Common-Attributes.html;
  https://gcc.gnu.org/gcc-15/changes.html; https://gcc.gnu.org/gcc-16/changes.html;
  https://gcc.gnu.org/bugzilla/show_bug.cgi?id=108896; glibc `misc/sys/cdefs.h`
  (local copy, glibc 2.44)
- SAL: https://learn.microsoft.com/en-us/cpp/code-quality/understanding-sal;
  https://github.com/dotnet/runtime/blob/main/src/coreclr/pal/inc/rt/sal.h (a `sal.h` copy);
  https://learn.microsoft.com/en-us/cpp/code-quality/annotating-function-parameters-and-return-values;
  https://learn.microsoft.com/en-us/cpp/code-quality/annotating-function-behavior
- win32metadata: https://github.com/microsoft/win32metadata (docs/projections.md,
  docs/spec.md, docs/copilot/plans/shift-left-annotation-spec.md,
  generation/WinSDK/autoTypes.json); https://github.com/microsoft/windows-rs;
  https://github.com/microsoft/CsWin32; https://github.com/marlersoft/zigwin32;
  https://github.com/marlersoft/win32json
- GObject Introspection: https://gi.readthedocs.io/en/latest/annotations/giannotations.html
  (source https://gitlab.gnome.org/GNOME/gobject-introspection/-/blob/main/docs/website/annotations/giannotations.rst);
  https://docs.gtk.org/gio/ctor.Task.new.html; the libnm double free (commit message):
  https://github.com/rhinstaller/anaconda/commit/1f04cffc3f4f79e5f2751883ff41513d8eb72e96;
  secondary: https://gitlab.gnome.org/GNOME/gjs/issues/275,
  https://gitlab.gnome.org/GNOME/pygobject/-/issues/196
- Swift: https://www.swift.org/documentation/cxx-interop/safe-interop/;
  https://developer.apple.com/documentation/swift/designating-nullability-in-objective-c-apis;
  https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms;
  https://github.com/swiftlang/swift/tree/main/stdlib/public/Platform
- C library contracts: https://sqlite.org/c3ref/close.html, https://sqlite.org/c3ref/column_blob.html,
  https://sqlite.org/c3ref/bind_blob.html, https://sqlite.org/c3ref/errcode.html (local
  `sqlite3.h` 3.54.0); https://man7.org/linux/man-pages/man2/close.2.html;
  https://open-std.org/JTC1/sc22/wg14/www/docs/n3322.pdf;
  https://osv.dev/vulnerability/CVE-2024-53192;
  https://lkml.iu.edu/hypermail/linux/kernel/2412.0/05308.html

Local evidence (all under `scratch-b/`): `t_bs_fields.h`, `t_bs_params.h`,
`t_bs_params2.h`, `t_bs_late.h`, `t_bs_misc.h` (bounds attributes);
`t_gcc_attrs.h`, `t_gcc_more.h`, `t_stdio.c`, `t_unistd.c` (GCC attributes and glibc);
`t_lifetime.h`, `t_lb_use.c` (lifetime, noescape, ownership, handles, nullability);
`t_nullcomp.h`, `t_nullarg.c` (nullability diagnostics); `t_enums.h`; `t_uapi.c`
(uapi `__counted_by`); `apinotes/` (API notes on a C module); `scripts/` (usage counts);
`dl-*/` (downloaded primary sources).
