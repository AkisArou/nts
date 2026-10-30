# C interop survey A: Swift, Rust, .NET, Java FFM

As of 2026-10-30. Written for the nts decision on how TypeScript calls C: what
can be generated from a header automatically and safely, and what someone must
state.

**Conventions.** Every claim below was read in the cited source during this
research unless it carries **(unverified)**, which means I could not confirm it
from a primary source and am stating it from general knowledge or inference.
Code examples are short sketches built on the documented APIs; where an example
is copied from a source it says so. Section numbers follow the thirteen
concepts in the brief.

## Versions this survey describes

| Toolchain | Version read | Notes |
|---|---|---|
| Swift | Swift 6.4 (released 2026-09-15), 6.3 (2026-03-24), 6.2 (2025-09-15) | Safe C interop wrappers are described by swift.org as experimental on 6.2 (`-enable-experimental-feature SafeInteropWrappers`); whether 6.3/6.4 turned them on by default is **(unverified)**: neither release post nor the CHANGELOG says so. |
| Rust | Rust 2024 edition (stable since 1.85.0, 2025-02-20); bindgen 0.73.2 (0.73.0 on 2026-09-05); rusqlite 0.41.1; cxx 1.0.205 (2026-10-11) | `unsafe extern` arrived in 1.82 for all editions. |
| .NET | .NET 10 docs (default moniker), .NET 11 monikers present | `LibraryImport` since .NET 7; `GCHandle<T>` since .NET 10. |
| Java | JDK 25 (LTS) javadoc; FFM final in JDK 22 (JEP 454) | No FFM API change in JDK 26/27 was found **(unverified)**; jextract master tracks the latest JDK. |

## Verdicts at a glance

| # | Concept | Best in class | Why, in one line |
|---|---|---|---|
| 1 | Where facts come from | Swift (attributes ≡ API notes) | One vocabulary, written in the header or in a module-keyed sidecar, read by the importer; win32metadata shows the same idea at Windows scale. |
| 2 | Struct layout and storage | .NET source generator + Java arenas; bindgen for layout checks | The compiler stack-allocates small marshalling temporaries; arenas name multi-call lifetimes; layouts are asserted at compile time. |
| 3 | Own values by pointer | .NET (pin only when representation matches) + Swift (call-scoped pointer, `__noescape`) | Zero-copy when safe, copy otherwise, and the retention rule is "for the call". |
| 4 | Buffers and counts | Swift 6.2 `__counted_by`/`__sized_by` → `Span`/`RawSpan` overloads | The header states elements vs bytes; the count parameter disappears and is checked. |
| 5 | Strings | Rust (`CString`/`CStr`) for clarity; .NET's free-on-return default is the anti-pattern | Owned vs borrowed are distinct types; nothing is freed implicitly. |
| 6 | Out and in-out parameters | CsWin32 friendly overloads | Out pointers become `out`/return values, with an overload that omits optional ones. |
| 7 | Errors | Swift `swift_error` conventions + Java `captureCallState` | A per-function convention maps to throws; errno is captured before the runtime clobbers it. |
| 8 | Handles and ownership | Rust (`Drop`, lifetimes, fallible `close(self)`); Swift 6.2 for zero-wrapper import | Deterministic release, dependency enforced by the borrow checker, failure reported where it can be. |
| 9 | Callbacks | Rust + Java FFM | `Send + 'static` bounds and abort-on-unwind; upcall stubs owned by an arena. |
| 10 | Nullability | Swift | Three states plus audited regions; "unspecified" traps on nil instead of UB. |
| 11 | Enums, macros, `static inline` | Swift | Open/closed enums, option sets, constant macros, and inline functions compiled directly. |
| 12 | Variadics | Java FFM | Each call shape is a specialized descriptor; non-promoted argument types are rejected. |
| 13 | Safety checking | Java (always-on dynamic checks) and Swift `Span` (static lifetime + dynamic bounds); Rust for the static `unsafe` boundary | Checked views where possible, a visible and narrow unsafe escape hatch everywhere. |

---

## 1. Where binding facts come from

| Toolchain | Header | In-header annotations | Side file | Hand-written | Inferred from implementation |
|---|---|---|---|---|---|
| Swift | ClangImporter reads it directly | Clang attributes (`_Nonnull`, `swift_name`, `enum_extensibility`, `swift_attr`, `__counted_by`, `__noescape`, `__lifetimebound`, `cf_returns_retained`, `swift_error`) | API notes (`<Module>.apinotes`, YAML) | Swift overlays/wrappers | No. Ownership can be *inferred from CF naming rules* inside `CF_IMPLICIT_BRIDGING_ENABLED` regions |
| Rust | bindgen (libclang) | no C nullability or bounds mapping found (none in its CHANGELOG); reads layouts, enums, macros | `build.rs` Builder options, `ParseCallbacks` | the `-sys` crate's safe wrapper crate (rusqlite) or a `cxx` bridge | No |
| .NET | ClangSharp scrapes headers for win32metadata | SAL annotations, made visible to the scraper | `Windows.Win32.winmd` metadata + `emitter.settings.rsp`/`scraper.settings.rsp` overrides | P/Invoke declarations by hand; `NativeMethods.txt`/`.json` for CsWin32 | No |
| Java | jextract (libclang) | none beyond the C types | jextract filter files (`--dump-includes`, `@file`) | hand-written `FunctionDescriptor`s | No |

**Swift.** The header is imported directly; API notes add facts without editing
it. A `.apinotes` file is named after the module and found next to its module
map; Clang reads it with `-fapinotes-modules`. Keys include `Nullability`,
`SwiftName`, `SwiftImportAs`, `SwiftRetainOp`/`SwiftReleaseOp`,
`SwiftReturnOwnership`, `SwiftCopyable`, `SwiftDestroyOp`, `SwiftSafety`,
`EnumKind`, `NoEscape` ("Used only for block parameters"), and per-parameter
`BoundsSafety`. Most keys are
documented as equivalent to an in-header attribute (`SwiftImportAs: reference`
≡ `SWIFT_SHARED_REFERENCE`, `SwiftReturnOwnership: retained` ≡
`swift_attr("returns_retained")`, `SwiftCopyable: false` ≡ `SWIFT_NONCOPYABLE`,
`NoEscape` ≡ `NS_NOESCAPE`), so a fact has one meaning whether the vendor wrote
it in the header or a third party wrote it beside it.

```yaml
# WebGPU.apinotes (from the swift.org blog, 2026-01-22)
Tags:
- Name: WGPUAdapterType
  EnumExtensibility: closed
- Name: WGPUBindGroupImpl
  SwiftImportAs: reference
  SwiftReleaseOp: wgpuBindGroupRelease
  SwiftRetainOp: wgpuBindGroupAddRef
```

Sources: https://clang.llvm.org/docs/APINotes.html ·
https://www.swift.org/blog/improving-usability-of-c-libraries-in-swift ·
https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ·
https://developer.apple.com/documentation/swift/working-with-core-foundation-types
("enclose C function declarations that follow the policy for Core Foundation
ownership naming, in order to infer memory management").
Note: the blog's `EnumExtensibility` key does not appear in the clang
APINotes page as fetched (which lists `EnumKind`); the blog's usage is the
evidence it works with Swift's Clang.

**Rust.** bindgen turns a header into `unsafe extern` declarations, `#[repr(C)]`
structs and constants; everything else is configured in `build.rs`.

```rust
let bindings = bindgen::Builder::default()
    .header("wrapper.h")
    .allowlist_function("sqlite3_.*")
    .no_copy("sqlite3")          // don't derive Copy/Clone for this type
    .wrap_static_fns(true)       // emit C wrappers for static inline functions
    .generate()?;
```

Sources: https://rust-lang.github.io/rust-bindgen/ ·
https://docs.rs/bindgen/latest/bindgen/struct.Builder.html (0.73.2).
Ownership, lifetimes and errors are stated by hand in a wrapper crate
(rusqlite over libsqlite3-sys, §8), or declared on both sides with `cxx`, whose
`#[cxx::bridge]` module is the single statement both code generators check
("static assertions for later in the build process to verify correctness"):

```rust
#[cxx::bridge]                       // abridged from cxx.rs
mod ffi {
    unsafe extern "C++" {
        include!("demo/blobstore.h");
        type BlobstoreClient;
        fn new_blobstore_client() -> UniquePtr<BlobstoreClient>;
    }
}
```

Source: https://cxx.rs/ · https://cxx.rs/extern-c++.html.

**.NET.** win32metadata scrapes the Windows SDK headers with ClangSharp
("traverses header files as defined within Partitions and generates C# files"),
applies remaps and attributes from `emitter.settings.rsp`, and writes
`Windows.Win32.winmd`; CsWin32 (C#) and windows-rs (Rust) generate from it. The
scraper compiles headers with `-D_USE_DECLSPECS_FOR_SAL=1 -D_PREFAST_=1` and
`generate-cpp-attributes`, so SAL annotations survive as attributes; the
documented SAL mapping is `_retval_` → `[RetVal]`. That the other attributes
(`In`, `Out`, `Optional`, `NativeArrayInfo`, `MemorySize`) are derived from
SAL rather than hand-written is **(unverified)**. CsWin32 then generates only
what `NativeMethods.txt` lists.

```text
# NativeMethods.txt (CsWin32): names, wildcards, '-' exclusions
CreateFile
CloseHandle
Kernel32.*
```

Sources: https://github.com/microsoft/win32metadata/blob/main/docs/architecture.md ·
https://github.com/microsoft/win32metadata/blob/main/docs/projections.md ·
https://github.com/microsoft/win32metadata/blob/main/sources/GeneratorSdk/tools/assets/scraper/baseSettings.rsp ·
https://github.com/microsoft/CsWin32/blob/main/docfx/docs/getting-started.md.

**Java FFM.** jextract parses headers and generates downcall wrappers, struct
accessors, constants and function-pointer interfaces; filtering is by a dumped
symbol list. JEP 454 lists header-to-Java tooling as a non-goal of the API
itself; jextract is separate.

```sh
jextract --dump-includes includes.txt mylib.h   # list every symbol
jextract @includes_filtered.txt mylib.h         # generate only the kept ones
```

Sources: https://github.com/openjdk/jextract/blob/master/doc/GUIDE.md ·
https://openjdk.org/jeps/454.

**Best design.** The header for everything it can say (prototypes, layouts,
enum values, constant macros, inline bodies), standard annotations when a vendor
wrote them, and one module-keyed sidecar for the rest, whose keys mean exactly
what the in-header attributes mean (Swift's model). Generate a neutral metadata
file once and check it against the header at build time (win32metadata's model
plus bindgen's layout asserts). None of the four infers facts from a C
implementation; ownership, retention and error conventions are not recoverable
from a prototype.

**Pitfalls.**
- API notes: "Due to a compiler bug, 'NullabilityOfRet' may change nullability
  of the parameters as well"; use `ResultType` instead (clang APINotes page).
- API notes only apply to modules: they "can't modify arbitrary textual
  headers", since they are identified by module name (clang APINotes page).
- bindgen evaluates the header for one target; a custom target needs
  `--target` passed to libclang (bindgen FAQ), or layouts and `long` widths are
  the host's.

---

## 2. Struct layout, storage and copying

| Toolchain | Who decides layout | Who decides stack vs heap for a temporary passed by pointer | Copy semantics | Scoped arenas |
|---|---|---|---|---|
| Swift | Clang (imported) | the Swift compiler; `&x` on a computed or non-addressable place materializes a temporary and writes it back | C structs are Swift value types, copied on assignment; `~Copyable` when annotated (§8) | `withUnsafeTemporaryAllocation` (stack when small) |
| Rust | `#[repr(C)]`, asserted by bindgen | the programmer (local = stack, `Box` = heap) | bindgen derives `Copy`/`Clone` unless `no_copy` | none in std |
| .NET | `StructLayout(Sequential)` (default for structs) | locals are on the stack; generated marshalling copies go on the stack when small (arrays ≤256 bytes, spans ≤512 bytes), else native heap | value types copied; blittable `ref` pinned, not copied | none built in |
| Java | `MemoryLayout`s (jextract emits them) | the programmer, always off-heap via an `Arena`; struct returns use a `SegmentAllocator` the caller passes | explicit `MemorySegment.copy` | confined, shared, auto, global; custom (slicing) arenas |

**Swift.** "Swift imports any C structure declared in a C header as a Swift
structure" with a stored property per field, a memberwise initializer and a
zeroing `init()`; unions become structs with overlapping computed properties;
bit-fields become computed properties; fixed-size arrays become tuples. For
`&value`, Apple DTS shows the compiler expands `gettimeofday(&time.combined,
nil)` into a temporary plus write-back.

```swift
var tv = timeval()                 // zeroed C struct, a Swift value
gettimeofday(&tv, nil)             // pointer valid only during this call
withUnsafeTemporaryAllocation(of: pollfd.self, capacity: 4) { fds in
    _ = poll(fds.baseAddress, 4, 0)   // stack if small, else heap (SE-0322)
}
```

Sources: https://developer.apple.com/documentation/swift/using-imported-c-structs-and-unions-in-swift ·
https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ·
https://developer.apple.com/forums/thread/674633 ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0322-temporary-buffers.md
(no fixed threshold: "moderately-sized constant", then a runtime
`_swift_stdlib_isStackAllocationSafe()` check).

**Rust.** `#[repr(C)]` is the only layout guaranteed to match C; for field-less
enums it is "really a 'best guess'". bindgen emits compile-time layout checks
(since 0.70):

```rust
const _: () = {                                    // bindgen output (test expectation)
    ["Size of foo"][::std::mem::size_of::<foo>() - 4usize];
    ["Offset of field: foo::member"][::std::mem::offset_of!(foo, member) - 0usize];
};
```

Sources: https://doc.rust-lang.org/reference/type-layout.html ·
https://github.com/rust-lang/rust-bindgen/blob/main/CHANGELOG.md ·
https://github.com/rust-lang/rust-bindgen/tree/main/bindgen-tests/tests/expectations/tests.

**.NET.** "Managed structs are created on the stack and aren't removed until the
method returns. By definition then, they are 'pinned'." Blittable structs pass
through unchanged; `bool` is not blittable. Source-generated stubs stack-allocate
array copies of at most 256 bytes and keep the built-in `string` stack
optimization (below `MAX_PATH`); `ReadOnlySpanMarshaller` copies into a
caller-allocated buffer of at most 512 bytes ("to avoid overflowing the stack")
and falls back to `NativeMemory.Alloc`.

```csharp
[StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
[LibraryImport("user32")] [return: MarshalAs(UnmanagedType.Bool)]
internal static partial bool PtInRect(ref Rect r, Point p);   // ref blittable: pinned
```

Sources: https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices ·
https://github.com/dotnet/runtime/blob/main/docs/design/libraries/LibraryImportGenerator/Compatibility.md ·
https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Runtime/InteropServices/Marshalling/ReadOnlySpanMarshaller.cs ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/custom-marshaller-shapes
("the generator will allocate a buffer of the specified size", `BufferSize`).

**Java FFM.** All native memory comes from an arena. Arena kinds: global
(never freed), automatic (GC frees it "at some unspecified time after" it is
unreachable), confined (one owner thread, closed explicitly) and shared (any
thread; closing is expensive because it must cancel concurrent access). A
custom arena can wrap a confined one with a slicing allocator.

```java
try (Arena arena = Arena.ofConfined()) {
    MemorySegment tv = arena.allocate(TIMEVAL_LAYOUT);           // off-heap
    int rc = (int) gettimeofday.invokeExact(tv, MemorySegment.NULL);
}                                                                // freed here
```

Sources: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html
(a struct return "accepts an additional leading parameter of type
`SegmentAllocator`").

**Best design.** Layout comes from the C compiler's own view and is asserted at
build time. Storage for a temporary is the compiler's choice, driven by escape
facts: the stack when the callee keeps nothing (`__noescape`), a small
caller-allocated buffer with a heap fallback for marshalled copies (.NET), and
an explicit scope (arena) only when a lifetime spans several calls (Java).

**Pitfalls.**
- C `long` is 32 bits on Windows and 64 elsewhere; .NET added `CLong`/`CULong`
  because C# `long` is always 64 (best practices); FFM's `long` layout differs
  the same way (Linker javadoc).
- .NET `bool` defaults to a 4-byte Win32 `BOOL`; C `_Bool` is one byte: "half
  the return value will be discarded" (best practices).
- bindgen padding fields (`__bindgen_padding_N`) must not be initialized by
  hand; use `Default` (bindgen FAQ).
- Fixed buffers of non-blittable types are not marshalled correctly in .NET
  (best practices).

---

## 3. Passing the language's own values to C by pointer

| Toolchain | Zero-copy (pinning) | Copy | C keeping the pointer after the call | Enforcement |
|---|---|---|---|---|
| Swift | `&var`, `[T]`, `&[T]` pass the storage directly when possible | `String` → temporary UTF-8 buffer | forbidden; "only guaranteed to be valid for the duration of the function call" | warnings for some escapes; `__noescape` gates `Span` overloads |
| Rust | slices and references (`as_ptr`) | explicit (`CString::new`) | the borrow ends with the call; raw pointers carry no lifetime | nothing past the call; ownership transfer is explicit (`Box::into_raw`) |
| .NET | blittable `in`/`ref`/`out` and arrays of blittable types pinned for the call | non-blittable data copied | requires `GCHandle(Pinned)`, the pinned object heap, `fixed` in scope, or native memory | GC moves unpinned objects; nothing checks native retention |
| Java | no: heap segments are rejected, except with `Linker.Option.critical(true)` for the call only | data copied into an arena segment | the arena's lifetime governs; a downcall keeps its argument segments alive | `IllegalStateException`/`WrongThreadException` on dead or foreign segments |

**Swift.** For `UnsafePointer<T>` one can pass an `UnsafePointer`, a `String`
("automatically converted to UTF8 in a zero-terminated buffer"), `&x`, or a
`[T]`; "The pointer you pass to the function is only guaranteed to be valid for
the duration of the function call. Do not persist the pointer". Since Swift 5.2
the compiler warns on some escapes:

```swift
var i: Int8 = 0
let ptr = UnsafePointer(&i)   // warning: initialization of 'UnsafePointer<Int8>'
                              // results in a dangling pointer
withUnsafePointer(to: &i) { p in use(p) }   // the scoped, correct form
```

Sources: https://developer.apple.com/documentation/swift/calling-functions-with-pointer-parameters ·
https://github.com/swiftlang/swift/blob/main/CHANGELOG.md (Swift 5.2 entry) ·
https://github.com/swiftlang/swift/blob/main/userdocs/diagnostics/temporary-pointers.md.

**Rust.** The nomicon's safe wrapper passes `src.as_ptr(), src.len()` inside
`unsafe` and keeps the public function safe "for all inputs". A transfer of
ownership is explicit (`Box::into_raw`/`from_raw`, `CString::into_raw`).

```rust
pub fn validate_compressed_buffer(src: &[u8]) -> bool {      // nomicon
    unsafe { snappy_validate_compressed_buffer(src.as_ptr(), src.len() as size_t) == 0 }
}
```

Source: https://doc.rust-lang.org/nomicon/ffi.html.

**.NET.** "When blittable types are passed by reference with `in`, `ref`, or
`out`, or when types with blittable contents are passed by value, they're
simply pinned by the marshaller instead of being copied." For longer
retention: `GCHandle.Alloc(obj, GCHandleType.Pinned)`, or
`GC.AllocateArray<T>(n, pinned: true)` (pinned object heap, .NET 5+).

```csharp
GCHandle handle = GCHandle.Alloc(obj, GCHandleType.Pinned);   // best practices
IntPtr ptr = handle.AddrOfPinnedObject();
handle.Free();
```

Sources: https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices ·
https://learn.microsoft.com/en-us/dotnet/api/system.gc.allocatearray.

**Java FFM.** "the linker will throw an `IllegalArgumentException` if the segment
is a heap memory segment, unless heap memory segments are explicitly allowed
through the `Linker.Option.critical(boolean)` linker option"; with
`critical(true)` the heap region "is exposed through a temporary native address
that is valid for the duration of the function call", and the function must be
extremely short and must not call back into Java.

```java
MethodHandle h = linker.downcallHandle(addr, desc, Linker.Option.critical(true));
long n = (long) h.invokeExact(MemorySegment.ofArray(bytes), (long) bytes.length);
```

Sources: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.Option.html.

**Best design.** Lend in place when the representation already matches and the
callee keeps nothing; copy into compiler-chosen scratch otherwise; refuse at
compile time to lend call-scoped storage to a parameter the binding does not
mark non-escaping, and require an explicit transfer (owned copy, counted
reference, or native storage with a named lifetime) when C keeps it. Swift's
"valid for the call" rule plus `__noescape` is that design; .NET's pinning
rules are its runtime half.

**Pitfalls.**
- Swift `&` to an API that keeps the buffer (`setvbuf`) compiles and can seem
  to work until optimisation or unrelated code changes; "Unfortunately the
  compiler isn't able to detect this problem" (Apple DTS,
  https://developer.apple.com/forums/thread/674633).
- Returning the pointer out of `withUnsafePointer(to:) { $0 }` is undefined
  behaviour (temporary-pointers diagnostic doc).
- .NET: "Intermittent crashes ... GC moved an unpinned object or collected a
  delegate" (best practices troubleshooting table).
- Java: a critical function that is not short "is likely to have adverse
  effects, such as loss of performance or JVM crashes" (Linker.Option).

---

## 4. Buffers and counts

| Toolchain | Pointer + length pair | Bytes vs elements | Caller-provided output buffer |
|---|---|---|---|
| Swift | `__counted_by(n)` → overload taking `Span`/`MutableSpan` (with `__noescape`) or `UnsafeBufferPointer` (without) | `__counted_by` = elements, `__sized_by` = bytes → `RawSpan` | `Array(unsafeUninitializedCapacity:initializingWith:)`; `OutputSpan` (SE-0485) |
| Rust | `&[T]` → `(as_ptr(), len())`; `slice::from_raw_parts` back | by type; `size_of` explicit | `Vec::with_capacity` + `set_len`; `MaybeUninit` |
| .NET | `Span<T>`/`ReadOnlySpan<T>` marshallers; `[MarshalUsing(CountElementName=…)]` for returned arrays; CsWin32 `Span` overloads | win32metadata: `NativeArrayInfo(CountParamIndex)` = elements, `MemorySize(BytesParamIndex)` = bytes | `[Out] char[]`/`byte[]` (ArrayPool); `Span<byte>` |
| Java | `MemorySegment` carries its byte size | segments are bytes; layouts give elements (`allocate(JAVA_INT, n)`) | allocate a segment, pass it, read back |

**Swift 6.2 safe interop** (experimental flag). From swift.org:

```c
int calculate_sum(const int * __counted_by(len) values __noescape, int len);
// Swift overload added: func calculate_sum(_ values: Span<CInt>) -> CInt
// original kept:       func calculate_sum(_ values: UnsafePointer<CInt>, _ len: CInt) -> CInt

void sum_vectors(const int * __counted_by(len) a __noescape,
                 const int * __counted_by(len) b __noescape,
                 int * __counted_by(len) out __noescape, int len);
// func sum_vectors(_ a: Span<CInt>, _ b: Span<CInt>, _ out: MutableSpan<CInt>)
// "will trap if a.count != b.count || b.count != out.count"
```

`__counted_by(columns * rows)` keeps both count parameters and inserts "a
bounds check ... to verify that `columns * rows == values.count`". Without
lifetime information the overload uses `UnsafeBufferPointer`, which keeps the
bounds checks "even in release builds". Limits: only the outermost pointer;
annotations on struct fields and globals are ignored. Facts can also come from
API notes (`BoundsSafety: Kind: counted_by, BoundedBy: "len"`). Output buffers:
`Array(unsafeUninitializedCapacity:initializingWith:)` (Swift 5.1) exists for
"C APIs that fill a buffer with an unknown number of elements" without zeroing;
SE-0485 `OutputSpan` (implemented in 6.2, standard library extensions
pending) is the bounds-checked form.

Sources: https://www.swift.org/documentation/cxx-interop/safe-interop/ ·
https://forums.swift.org/t/c-annotations-counted-by-and-noescape-not-producing-span-consuming-function-signatures/83333 ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0245-array-uninitialized-initializer.md ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0485-outputspan.md ·
https://clang.llvm.org/docs/BoundsSafety.html (`__counted_by`, `__sized_by`,
`__counted_by_or_null`, `__ended_by`, `__null_terminated`; external annotations
"do not change the pointer representation").

**Rust.** The nomicon's snappy wrapper sizes a `Vec` with
`snappy_max_compressed_length`, passes it as an output parameter with an
in/out length, then sets the length:

```rust
let mut dst = Vec::with_capacity(max);
let mut len = max as size_t;
unsafe {
    snappy_compress(src.as_ptr(), src.len() as size_t, dst.as_mut_ptr(), &mut len);
    dst.set_len(len as usize);
}
```

`slice::from_raw_parts` requires `data` "non-null and aligned even for
zero-length slices"; its doc shows mapping a NULL from C to `&[]` first.
Sources: https://doc.rust-lang.org/nomicon/ffi.html ·
https://doc.rust-lang.org/std/slice/fn.from_raw_parts.html.

**.NET.**

```csharp
[LibraryImport("nativelib")]                                // custom marshalling docs
[return: MarshalUsing(typeof(ListMarshaller<,>), CountElementName = nameof(numValues))]
internal static partial List<int> ConvertList(
    [MarshalUsing(typeof(ListMarshaller<,>))] List<int> list, out int numValues);
```

`ReadOnlySpanMarshaller.ManagedToUnmanagedIn` pins the span directly
(`GetPinnableReference`) or copies; it "will pass a non-null value for a
zero-length span if the span was constructed with a non-null value". Whether
`LibraryImport` applies the span marshallers to a bare `Span<T>` parameter
without `[MarshalUsing]` is **(unverified)**. CsWin32 generates "overloads of
these functions that take a `Span<byte>`" from the metadata. Sources:
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/custom-marshalling-source-generation ·
https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.marshalling.readonlyspanmarshaller-2 ·
https://github.com/microsoft/win32metadata/blob/main/docs/projections.md ·
https://github.com/microsoft/CsWin32/blob/main/docfx/docs/getting-started.md.

**Java FFM.**

```java
MemorySegment array = arena.allocateFrom(ValueLayout.JAVA_INT, unsortedArray); // copy in
qsort.invoke(array, (long) unsortedArray.length, ValueLayout.JAVA_INT.byteSize(), compareFunc);
int[] sorted = array.toArray(ValueLayout.JAVA_INT);                           // copy out
```

(From the Oracle qsort guide.) Every access is bounds-checked against the
segment's size. Source:
https://docs.oracle.com/en/java/javase/25/core/upcalls-passing-java-code-function-pointer-foreign-function.html.

**Best design.** The binding states, per pointer, its count expression and
whether it counts elements or bytes (Swift's `__counted_by`/`__sized_by`,
win32metadata's `NativeArrayInfo`/`MemorySize`). The generated call takes one
view argument, derives the count parameter, and traps when several buffers
must agree and do not. Output buffers use an initialized-count protocol, so
nothing is zeroed for C to overwrite.

**Pitfalls.**
- Rust: C commonly passes `(NULL, 0)`; `from_raw_parts(NULL, 0)` is undefined
  behaviour (std docs).
- .NET `StringBuilder` buffers: "the capacity does not include a hidden null";
  four allocations per call (best practices). Use `ArrayPool` arrays.
- .NET passes a non-null pointer for an empty span built from non-null memory;
  a C API that distinguishes NULL from empty sees a difference (marshaller
  remarks).
- Swift ignores bounds annotations on struct fields (safe-interop page), so a
  counted field gets no safe accessor.

---

## 5. Strings in both directions

| Toolchain | To C | From C | Who frees a returned string | Borrowed results |
|---|---|---|---|---|
| Swift | `String` → temporary NUL-terminated UTF-8 for the call; `withCString` | `String(cString:)` copies and repairs ill-formed UTF-8; `String(validatingCString:)` fails instead | the caller, by hand; CF objects by ARC when annotated | `__lifetimebound` returns a `Span` tied to the argument (`@lifetime(x)`) |
| Rust | `CString` (owned, no interior NUL; `new` errors on one); `c"…"` literals | `CStr::from_ptr` borrows; `to_str` fails on bad UTF-8, `to_string_lossy` replaces | the foreign allocator's free, by hand; `CString::from_raw` only for Rust's own | unbounded lifetime from `from_ptr`; wrappers tie it (rusqlite `ValueRef<'_>`) |
| .NET | `StringMarshalling.Utf8`/`Utf16` must be stated; UTF-16 pinned in place | `Utf8StringMarshaller`; or `IntPtr` + `Marshal.PtrToStringUTF8` | **the marshaller frees** returned strings (`CoTaskMemFree` on Windows, `free` elsewhere) unless you return `IntPtr` | none |
| Java | `arena.allocateFrom(String)`/`setString`: NUL-terminated UTF-8 by default, charset selectable | `getString(offset[, charset])` reads to the NUL, replaces malformed input | by hand, or attach `free` with `reinterpret(…, arena, cleanup)` | segments returned by C have size 0 and global scope |

**Swift.**

```swift
let n = strlen("héllo")                      // String → temporary UTF-8, for this call
let s = String(cString: getenv("HOME"))      // copy; ill-formed UTF-8 → U+FFFD
"path".withCString { p in open(p, O_RDONLY) } // scoped borrow
```

Sources: https://developer.apple.com/documentation/swift/calling-functions-with-pointer-parameters ·
https://github.com/swiftlang/swift/blob/main/stdlib/public/core/CString.swift ·
https://www.swift.org/documentation/cxx-interop/safe-interop/.

**Rust.**

```rust
let c = CString::new("hi")?;                 // Err(NulError) on an interior NUL
unsafe { puts(c.as_ptr()) };                 // c must outlive the call
let back: &CStr = unsafe { CStr::from_ptr(p) }; // borrow; lifetime is unbounded
let text = back.to_string_lossy();           // Cow<str>, U+FFFD on bad UTF-8
```

Sources: https://doc.rust-lang.org/std/ffi/struct.CString.html ·
https://doc.rust-lang.org/std/ffi/struct.CStr.html ("CStr does not have a
guaranteed layout ... should not be placed in the signatures of FFI
functions").

**.NET.**

```csharp
[LibraryImport("c", StringMarshalling = StringMarshalling.Utf8)]
internal static partial int puts(string s);        // copied to UTF-8, freed after the call
[LibraryImport("c", StringMarshalling = StringMarshalling.Utf8)]
internal static partial IntPtr getenv(string name); // C owns the result: return IntPtr
string? home = Marshal.PtrToStringUTF8(getenv("HOME"));
```

"A `string` is pinned and used directly by native code (rather than copied)
when passed by value" with UTF-16 marshalling; the source generator "makes no
assumptions about `StringMarshalling` if it is not explicitly set". Sources:
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/default-marshalling-behavior ·
https://github.com/dotnet/runtime/blob/main/docs/design/libraries/LibraryImportGenerator/Compatibility.md.

**Java FFM.**

```java
MemorySegment cs = arena.allocateFrom("%d plus %d");          // UTF-8, NUL-terminated
MemorySegment p  = (MemorySegment) getenv.invokeExact(name);  // size 0, global scope
String home = p.reinterpret(Long.MAX_VALUE).getString(0);     // restricted method
```

The last line is a common idiom, not from the javadoc **(unverified as a
documented pattern)**; a zero-length segment must be reinterpreted before any
read. `getString` throws `IndexOutOfBoundsException` "if no string terminator
... is present in this segment", and "always replaces malformed-input and
unmappable-character sequences". Sources:
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/MemorySegment.html.

**Best design.** In: borrow UTF-8 (or the representation C names) for the call,
in place when the bytes already match, else into scratch; an interior NUL is an
error at the boundary. Out: copy and decode, with a stated rule for ownership
(borrowed, or freed by a named function) and, for borrowed results, a lifetime
tied to the owner. Never free a returned pointer implicitly.

**Pitfalls.**
- .NET frees returned strings with `CoTaskMemFree`/`free`; for a string C
  owns, "the common language runtime attempts to free `b` twice" (default
  marshalling behaviour). A wrong allocator shows as "Heap corruption on free"
  (best practices).
- .NET: "DON'T use `[Out] string` parameters ... can destabilize the runtime if
  the string is an interned string" (best practices).
- Rust: `CString::new(..).unwrap().as_ptr()` dangles at the end of the
  statement; the `dangling_pointers_from_temporaries` lint (warn by default)
  catches the simple cases (CString docs, rustc lint listing).
- Rust: `CString::from_raw` on a C-allocated string is "likely to lead to
  undefined behavior or allocator corruption" (CString docs).
- Java: writing a string that contains `'\0'` copies it, so it "will appear
  truncated when read again" (MemorySegment `setString`).

---

## 6. Output and in-out parameters

| Toolchain | Mechanism | Initialized first? |
|---|---|---|
| Swift | `inout` + `&` to `UnsafeMutablePointer<T>`; an error out parameter → `throws` via `swift_error` (`NSError **` for Objective-C; the `CFErrorRef *` case for C **(unverified)**) | yes, a Swift `var` must be initialized (zeroing cost) |
| Rust | `&mut x as *mut T`, or `MaybeUninit::as_mut_ptr` then `assume_init` | not required with `MaybeUninit` |
| .NET | `out`/`ref`/`in`; blittable ones pinned, others copied by `ManagedToUnmanagedOut`/`Ref` marshallers; CsWin32 overloads with and without optional out params | `out` need not be |
| Java | allocate a segment, pass it, read it back | yes: segments from the built-in arenas "are zero-initialized" (custom arenas may differ) |

```swift
var rem: Int32 = 0
let q = quotient(7, 2, &rem)       // C: int quotient(int, int, int *remainder)
```

```rust
let mut v = MaybeUninit::uninit();          // std MaybeUninit "out-pointers"
unsafe { make_vec(v.as_mut_ptr()); }
let v = unsafe { v.assume_init() };
```

```csharp
[LibraryImport("lib")] internal static partial int get_size(nint h, out nuint size); // pinned
```

```java
MemorySegment out = arena.allocate(ValueLayout.JAVA_INT);
int rc = (int) getValue.invokeExact(out);
int value = out.get(ValueLayout.JAVA_INT, 0);
```

CsWin32: for optional `ref`/`out` parameters "CsWin32 will generate two
versions: one with all `ref` or `out` parameters included" and one without.
.NET: the `MarshalMode` table gives `ManagedToUnmanagedOut` for "`out`
parameters and return values" and `ManagedToUnmanagedRef` for `ref`.

Sources: https://developer.apple.com/documentation/swift/using-imported-c-functions-in-swift ·
https://doc.rust-lang.org/std/mem/union.MaybeUninit.html ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/custom-marshalling-source-generation ·
https://github.com/microsoft/CsWin32/blob/main/docfx/docs/getting-started.md ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html.

**Best design.** Out pointers become return values (a tuple or object when
several), with the storage on the caller's stack and no zeroing when the
contract says C writes on success; an optional out parameter gets an overload
without it (CsWin32); an error out parameter becomes a throw (Swift
`swift_error`, nts's `@ntsThrows`).

**Pitfalls.**
- Rust: creating a reference to uninitialized memory is undefined behaviour;
  write through the raw pointer only (MaybeUninit docs).
- .NET: `[In]`/`[Out]` are honoured only on by-value parameters under
  `LibraryImport`; by-ref ones use `in`/`ref`/`out` (Compatibility.md).
- .NET: `in`, `ref` and `out` parameters stop working under
  `DisableRuntimeMarshalling` (disabled-marshalling page).

---

## 7. Error conventions

| Toolchain | errno / last error | NULL / return codes | Error out-parameter | Mapped to |
|---|---|---|---|---|
| Swift | read `errno` by hand; swift-system maps it to `Errno: Error` | `swift_error(null_result / zero_result / nonzero_result)` | `swift_error(nonnull_error)` for an error parameter | `throws` |
| Rust | `io::Error::last_os_error()` "immediately after" the call | wrapper checks, returns `Result` | wrapper | `Result` |
| .NET | `SetLastError = true` + `Marshal.GetLastPInvokeError()` (errno on Unix) | `PreserveSig=false` (DllImport only) or `Marshal.ThrowExceptionForHR`; CsWin32 `HRESULT.ThrowOnFailure()` | wrapper | exceptions |
| Java | `Linker.Option.captureCallState("errno")` (also `GetLastError`, `WSAGetLastError` on Windows) | by hand | by hand | by hand |

**Swift.** Clang's `swift_error` "controls whether a particular function (or
Objective-C method) is imported into Swift as a throwing function"; conventions
are `none`, `nonnull_error`, `null_result`, `nonzero_result`, `zero_result`.
Which parameter types qualify as the error parameter for a plain C function
(`CFErrorRef *` assumed) is **(unverified)**. swift-system wraps syscalls with
`valueOrErrno(retryOnInterrupt:)` into `Result<CInt, Errno>` and throws `Errno`.

```c
int parse(const char *s, CFErrorRef *error) __attribute__((swift_error(nonzero_result)));
// imported as a throwing function (exact imported signature unverified)
```

Sources: https://clang.llvm.org/docs/AttributeReference.html ·
https://github.com/apple/swift-system/blob/main/Sources/System/FileOperations.swift ·
https://github.com/apple/swift-system/blob/main/Sources/System/Errno.swift.

**Rust.**

```rust
let fd = unsafe { libc::open(path.as_ptr(), libc::O_RDONLY) };
if fd < 0 { return Err(std::io::Error::last_os_error()); }  // read errno at once
```

"This should be called immediately after a call to a platform function,
otherwise the state of the error value is indeterminate." Source:
https://doc.rust-lang.org/std/io/struct.Error.html.

**.NET.**

```csharp
[LibraryImport("libc", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
internal static partial int chdir(string path);
if (chdir(p) != 0) throw new Win32Exception(Marshal.GetLastPInvokeError());
```

Sources: https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.marshal.getlastpinvokeerror ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation
(`PreserveSig` "has no equivalent" on `LibraryImport`) ·
https://github.com/microsoft/CsWin32/blob/main/src/Microsoft.Windows.CsWin32/templates/HRESULT.cs.

**Java FFM.** The option saves state "immediately after calling a foreign
function ... before it can be overwritten by the Java runtime":

```java
Linker.Option ccs = Linker.Option.captureCallState("errno");       // javadoc example
MethodHandle h = Linker.nativeLinker().downcallHandle(target, FunctionDescriptor.ofVoid(), ccs);
StructLayout l = Linker.Option.captureStateLayout();
VarHandle errnoHandle = l.varHandle(PathElement.groupElement("errno"));
try (Arena arena = Arena.ofConfined()) {
    MemorySegment state = arena.allocate(l);
    h.invoke(state);
    int errno = (int) errnoHandle.get(state, 0L);
}
```

Source: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.Option.html.

**Best design.** A per-function error convention stated in the binding, using
Swift's vocabulary (which result value means failure, or which out parameter
carries the error), with errno captured by the generated stub in the same
instant as the call (Java's and .NET's design, because a runtime may make
calls of its own), mapped to the language's exception with a named converter.

**Pitfalls.**
- .NET's `GetLastPInvokeError` only reports calls declared `SetLastError=true`,
  and `SetLastError=true` stops working under `DisableRuntimeMarshalling`.
- .NET (DllImport): "If the API sets a condition that says it has an error,
  get the error before making other calls" (best practices).
- Rust: other standard library calls "may (or may not) reset the error value
  even if they succeed" (io::Error docs).

---

## 8. Handles and ownership

| Toolchain | Release function | Unique vs shared | Deterministic vs finalizer | Dependent handles | Release that can fail |
|---|---|---|---|---|---|
| Swift | `SWIFT_SHARED_REFERENCE(retain, release)` / `SwiftRetainOp`+`SwiftReleaseOp`; `SwiftDestroyOp` / `swift_attr("destroy:fn")` for noncopyable C structs; `Unmanaged` for unannotated CF | shared = imported class (ARC); unique = `~Copyable` + `deinit` | deterministic (ARC, end of lifetime) | a child object holds a strong reference to its parent (pattern); `~Escapable` (`SWIFT_NONESCAPABLE`) + `@lifetime` is the borrow form, documented for C++ types (for C types **unverified**) | `deinit` cannot report it; a `consuming func close() throws` + `discard self` can |
| Rust | `Drop` | unique by default; `Rc`/`Arc` for shared | deterministic; `mem::forget` is safe, so it is not guaranteed | lifetimes: `Statement<'conn>` borrows its `Connection` | `close(self) -> Result<(), (Self, Error)>`; `Drop` ignores the error |
| .NET | `SafeHandle.ReleaseHandle()`; CsWin32 SafeHandles from `RAIIFree`/`FreeWith` | reference-counted `SafeHandle`; `ownsHandle` | `Dispose` deterministic; critical finalizer as fallback | child keeps a reference to and `DangerousAddRef`s its parent (pattern; CsWin32's `Lease()` pairs AddRef/Release) | `ReleaseHandle` returns `false`; only a .NET Framework MDA reports it; "must never fail" |
| Java | `reinterpret(size, arena, cleanup)` attaches the release call to an arena | per arena | confined/shared arenas close deterministically; auto arenas by GC | share an arena or close in order (manual) | unspecified (javadoc does not say) |

**Swift (C types, Swift 6.2).** A set of Swift PRs merged to `main` in July
2025 and cherry-picked to `release/6.2` on 2025-08-14 ("A number of Swift/C
interoperability features are gated behind C++ interoperability") enabled
foreign reference types in plain C interop, noncopyable C structs, the
`destroy:` operation and `SWIFT_NONCOPYABLE_WITH_DESTROY` in `<swift/bridging>`.
The blog notes some of this needs Swift 6.2.3 bug fixes.

```c
typedef struct __attribute__((swift_attr("~Copyable")))
               __attribute__((swift_attr("destroy:wgpuAdapterInfoFreeMembers")))
  WGPUAdapterInfo { /*...*/ } WGPUAdapterInfo;            // from swiftlang/swift#83364
void wgpuAdapterInfoFreeMembers(WGPUAdapterInfo adapterInfo);
```

```yaml
Tags:                                     # the same fact as API notes
- Name: WGPUAdapterInfo
  SwiftCopyable: false
  SwiftDestroyOp: wgpuAdapterInfoFreeMembers
Functions:
- Name: wgpuDeviceCreateBindGroup         # illustrative name
  SwiftReturnOwnership: retained
```

For shared references: "Calling unannotated functions that return a shared
reference type currently triggers a compiler warning" and will become an error.
For CF: annotated APIs are "automatically memory-managed"; unannotated returns
arrive as `Unmanaged<T>`, to be converted at once with `takeRetainedValue()` or
`takeUnretainedValue()`. A hand-written unique wrapper:

```swift
struct Statement: ~Copyable {
    private let raw: OpaquePointer
    deinit { sqlite3_finalize(raw) }
    consuming func finalize() throws {           // the fallible, explicit path
        let rc = sqlite3_finalize(raw)
        discard self                              // SE-0390: ends self without deinit
        if rc != SQLITE_OK { throw SQLiteError(rc) }
    }
}
```

Sources: https://github.com/swiftlang/swift/pull/83364 ·
https://github.com/swiftlang/swift/pull/83677 ·
https://lists.llvm.org/pipermail/cfe-commits/Week-of-Mon-20250811/741254.html ·
https://www.swift.org/blog/improving-usability-of-c-libraries-in-swift ·
https://www.swift.org/documentation/cxx-interop/ ·
https://developer.apple.com/documentation/swift/working-with-core-foundation-types ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0390-noncopyable-structs-and-enums.md ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0377-parameter-ownership-modifiers.md
(noncopyable parameters must say `borrowing` or `consuming`). That `deinit`
cannot throw is a language rule not re-sourced here **(unverified)**.

**Rust (rusqlite over libsqlite3-sys).**

```rust
let conn = Connection::open("app.db")?;
{
    let mut stmt = conn.prepare("SELECT x FROM t")?;   // Statement<'_> borrows conn
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let v = row.get_ref(0)?;                        // ValueRef<'_>, no copy
    }
}                                                       // finalized here
if let Err((conn, e)) = conn.close() { /* still open: retry or report */ }
```

`close` "on failure ... returns an error and the connection itself (presumably
so closing can be attempted again)"; the source's `impl Drop for
InnerConnection` calls `self.close()` under `#[expect(unused_must_use)]`, so a
failure in `Drop` is ignored. `Connection` is `Send` and `!Sync`; `Statement`
is neither. `get_ref`: "This `ValueRef` is valid only as long as this Row,
which is enforced by its lifetime." Unsafe escape hatches: `handle()`,
`from_handle`, `from_handle_owned`. Sources:
https://docs.rs/rusqlite/latest/rusqlite/struct.Connection.html ·
https://docs.rs/rusqlite/latest/rusqlite/struct.Statement.html ·
https://docs.rs/rusqlite/latest/rusqlite/struct.Row.html ·
https://github.com/rusqlite/rusqlite/blob/master/src/inner_connection.rs ·
https://doc.rust-lang.org/std/mem/fn.forget.html ("Rust's safety guarantees do
not include a guarantee that destructors will always run").

**.NET.**

```csharp
sealed class SqliteHandle : SafeHandle {
    public SqliteHandle() : base(IntPtr.Zero, ownsHandle: true) { }   // required for out/ref/return
    public override bool IsInvalid => handle == IntPtr.Zero;
    protected override bool ReleaseHandle() => sqlite3_close_v2(handle) == 0;
}
[LibraryImport("sqlite3", StringMarshalling = StringMarshalling.Utf8)]
internal static partial int sqlite3_open(string path, out SqliteHandle db);
```

"Platform invoke operations automatically increment the reference count of
handles encapsulated by a SafeHandle and decrement them upon completion",
which defeats handle-recycling attacks; the critical finalizer runs after
normal finalizers. `ReleaseHandle` "is guaranteed to be called only once";
returning `false` "generates a releaseHandleFailed Managed Debugging Assistant
when running on .NET Framework", and the code "must never fail". Best
practices: "DO use SafeHandle", "AVOID finalizers". CsWin32: "`RAIIFree` and
compatible `FreeWith` annotations on return values and output parameters tell
CsWin32 which cleanup function owns that particular result"; win32metadata
also has `DoNotRelease` for "unowned" handles. Sources:
https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle ·
https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle.releasehandle ·
https://github.com/dotnet/runtime/blob/main/docs/design/libraries/LibraryImportGenerator/Compatibility.md ·
https://github.com/microsoft/CsWin32/blob/main/docfx/docs/getting-started.md ·
https://github.com/microsoft/win32metadata/blob/main/docs/projections.md.

**Java FFM.**

```java
MemorySegment p = (MemorySegment) counterNew.invokeExact(1);   // size 0, global scope
MemorySegment counter = p.reinterpret(arena, s -> {            // restricted
    try { counterDestroy.invokeExact(s); } catch (Throwable t) { throw new RuntimeException(t); }
});                                                            // destroyed when arena closes
```

The cleanup "receives a segment that is associated with the global arena's
scope"; for an automatic arena it "must not prevent the arena from becoming
unreachable". What happens when a cleanup throws, and the order of several
cleanups, are not stated in the javadoc excerpt read **(unverified)**.
Closing an arena twice "always results in an exception". Sources:
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/MemorySegment.html ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html ·
https://github.com/openjdk/jextract/blob/master/doc/GUIDE.md.

**Best design.** The binding states, per function, whether a result is owned,
borrowed or shared, and names its release (or retain/release pair); the
importer turns a unique handle into a noncopyable value with a destructor and
a shared one into a counted reference (Swift 6.2), with no hand-written
wrapper. A handle that depends on another borrows it (Rust's lifetime) or
holds a counted reference to it. Release that can fail gets an explicit
consuming `close()` that returns the error, while the implicit release cannot
fail (rusqlite, Swift `discard self`). Deterministic release beats finalizers
in all four ecosystems' own guidance.

**Pitfalls.**
- rusqlite CVE-2020-35866 … CVE-2020-35873 (RUSTSEC-2020-0014): "several memory
  safety issues" in a mature safe wrapper (`get_aux`/`set_aux`, `Session`,
  `trace::log`, `vtab::create_module`), patched in 0.23.0.
  https://rustsec.org/advisories/RUSTSEC-2020-0014.html
- Swift runtime bug: a `~Copyable` type with a user `deinit` and POD fields
  could be treated as trivially destructible, so the user's `deinit` did not
  run when destruction went through the value witness table; fixed on `main`
  2026-06-09
  (https://github.com/swiftlang/swift/pull/89686); the first release with the
  fix is **(unverified)**. This is exactly the shape of an imported C handle.
- .NET: finalizers can run "while executing a method within a platform invoke
  call", freeing a handle in use; Windows "aggressively recycles handles"
  (SafeHandle remarks).
- Rust: `mem::forget` and `Rc` cycles mean a guard's `Drop` may never run, so
  a "registration guard" cannot be the only thing keeping C from calling a
  freed callback.

---

## 9. Callbacks

| Toolchain | Plain function pointer | Context pointer | Lifetime of the callback | Exception inside, C frames on stack | Other threads | Re-entrancy |
|---|---|---|---|---|---|---|
| Swift | `@convention(c)`; cannot capture context (compile error) | `Unmanaged.passRetained(obj).toOpaque()` / `fromOpaque` | by hand | Swift errors cannot be represented in a C function type **(unverified, inferred from diagnostics)**; C++ exceptions reaching Swift terminate | no checks **(unverified)** | exclusivity violations trap at runtime |
| Rust | `extern "C" fn`; nullable as `Option<…>` | `*mut c_void` to a boxed closure (trampoline) | by hand; wrappers demand `'static` | a panic at an `extern "C"` boundary aborts (1.81+); `catch_unwind` in trampolines; a foreign exception entering Rust is UB | `Send` bounds; nomicon: synchronize, or forward via channels | aliasing rules apply; wrappers use `RefCell` |
| .NET | `[UnmanagedCallersOnly]` + `delegate* unmanaged` (preferred) or delegates | `GCHandle.ToIntPtr` / `FromIntPtr` (`GCHandle<T>` in .NET 10) | delegates must be kept alive; `GCHandle` freed by hand | unsupported off Windows: fail-fast; never on NativeAOT | **(unverified)** for modern .NET | no checks |
| Java | `upcallStub(MethodHandle, FunctionDescriptor, Arena)` | captured by the method handle | the stub lives as long as its arena | "the JVM will terminate abruptly"; wrap with `catchException` | native threads attached automatically (panama-dev; JDK 25 behaviour **unverified**) | an upcall "is typically executed in the context of a downcall"; nested downcalls from it **(unverified)**; critical functions must not upcall |

**Swift.**

```swift
final class Box { let fire: () -> Void; init(_ f: @escaping () -> Void) { fire = f } }
let ctx = Unmanaged.passRetained(Box { print("tick") }).toOpaque()
register_cb({ raw in                                  // non-capturing literal: OK
    Unmanaged<Box>.fromOpaque(raw!).takeUnretainedValue().fire()
}, ctx)
// after unregistering: Unmanaged<Box>.fromOpaque(ctx).release()
```

"C function pointers are always imported as `@convention(c)` 'closures' (in
quotes because they don't have a context pointer, so they are not real
closures)"; the compiler's error is "a C function pointer cannot be formed from
a closure that captures context". C++ interop: "the running program terminates
with a fatal error when a C++ exception that's not caught by C++ code reaches
Swift code". Swift 5 checks exclusive access at runtime in release builds and
traps with "Simultaneous accesses to …, but modification requires exclusive
access" for class properties, globals and escaping closures. Sources:
https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ·
https://github.com/swiftlang/swift/blob/main/include/swift/AST/DiagnosticsSIL.def ·
https://developer.apple.com/documentation/swift/unmanaged ·
https://www.swift.org/documentation/cxx-interop/status/ ·
https://www.swift.org/blog/swift-5-exclusivity/.

**Rust.** The nomicon passes a raw pointer to the Rust object as the callback
target and warns for library threads: "proper synchronization mechanisms must
be used", and "it is also absolutely necessary that no more callbacks are
performed by the C library after the respective Rust object gets destroyed ...
by unregistering the callback in the object's destructor". rusqlite's
trampoline:

```rust
unsafe extern "C" fn busy_handler_callback<F>(p_arg: *mut c_void, count: c_int) -> c_int
where F: FnMut(i32) -> bool {
    unsafe { c_int::from(catch_unwind(|| (*p_arg.cast::<F>())(count)).unwrap_or_default()) }
}   // registration requires F: FnMut(i32) -> bool + Send + 'static
```

Rust 1.81: "the non-unwind ABIs (e.g., "C") will now abort on uncaught
unwinds"; use `"C-unwind"` when unwinding is intended. A foreign exception
crossing a non-unwind boundary "will cause undefined behavior". rusqlite keeps
its connection in a `RefCell` (`self.db.borrow_mut()`), so a re-entrant call
from inside a callback would panic rather than alias **(inferred from source)**.
Sources: https://doc.rust-lang.org/nomicon/ffi.html ·
https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/ ·
https://github.com/rusqlite/rusqlite/blob/master/src/busy.rs ·
https://docs.rs/rusqlite/latest/rusqlite/struct.Connection.html.

**.NET.**

```csharp
[UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) })]
static void OnTick(nint ctx) {
    try { ((Ticker)GCHandle.FromIntPtr(ctx).Target!).Fire(); }
    catch (Exception) { /* must not escape into C frames */ }
}
var h = GCHandle.Alloc(ticker);
unsafe { register_cb(&OnTick, GCHandle.ToIntPtr(h)); }   // later: h.Free()
```

`UnmanagedCallersOnly` methods must be static, blittable, non-generic and never
called from managed code. "Unmanaged code exception interop is supported on
Windows platforms only"; maintainers: "Interop with unmanaged exception
handling is supported only by regular CoreCLR and only on Windows. It is not
supported by native AOT"; passing exceptions through native code is
"guaranteed to fail-fast on other platforms". For delegates: "the garbage
collector does not track the relationship between the returned pointer and the
source delegate" (use `GC.KeepAlive`, or a static field when C keeps it).
Sources: https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.unmanagedcallersonlyattribute ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/exceptions-interoperability ·
https://github.com/dotnet/runtime/issues/97952 ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices ·
https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.gchandle-1.

**Java FFM.**

```java
MemorySegment compareFunc = linker.upcallStub(compareHandle, qsortCompareDesc,
                                              Arena.ofAuto());   // Oracle qsort guide
```

"The lifetime of the returned upcall stub segment is controlled by the provided
arena ... will be deallocated when the provided confined arena is closed." "If
the target method handle does throw an exception, the JVM will terminate
abruptly"; `upcallStub` throws `IllegalArgumentException` "if it is determined
that the target method handle can throw an exception". Upcalls from threads
native code created are attached to the VM automatically (JDK-8226250, 2019;
lazy detach JDK-8270851, 2021–22) per Panama mailing-list reviews, read via
search summaries; the javadoc read here does not say, so the current JDK 25
behaviour is **(unverified)**. Sources:
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html ·
https://docs.oracle.com/en/java/javase/25/core/upcalls-passing-java-code-function-pointer-foreign-function.html ·
https://mail.openjdk.org/pipermail/panama-dev/2019-June/005779.html ·
https://mail.openjdk.org/pipermail/panama-dev/2021-July/014507.html.

**Best design.** Classify each callback's lifetime in the binding (during the
call; until a destroy-notify or unregister; exactly once; forever) and
generate the context pointer, the trampoline and its release from that class;
the callback's owner is the registration, not a guard that might be leaked.
Nothing unwinds through C frames: the trampoline converts a throw into an
error result or ends the process, naming the boundary (Rust 1.81, Java, cxx
all abort; .NET fail-fasts). Thread affinity is stated, and a callback from a
foreign thread is posted to the owner rather than run on it.

**Pitfalls.**
- .NET's classic bug: a delegate collected while C still holds its function
  pointer ("Intermittent crashes", best practices; default marshalling page).
- Java: an upcall stub in a confined arena dies when the arena closes; C
  calling it later is a crash.
- Java: in the panama-dev review of JDK-8270851, reviewers noted that
  automatic attach/detach of unknown native threads has a real cost and that a
  thread never detached leaks VM resources (paraphrased; read via a search
  summary of the thread).
- Rust: `catch_unwind` "will only catch unwinding panics, not those that abort
  the process" (nomicon).
- Swift: no context in `@convention(c)`; forgetting the balancing `release()`
  of a `passRetained` leaks, an extra one is a use-after-free.

---

## 10. Nullability, and the default when a header says nothing

| Toolchain | Annotated | Unannotated default |
|---|---|---|
| Swift | `_Nonnull` → non-optional; `_Nullable` → optional; `assume_nonnull` regions (`NS_ASSUME_NONNULL_BEGIN`) | implicitly unwrapped optional (`T!`): an `Optional` force-unwrapped where needed, so nil traps on use |
| Rust | bindgen maps no C nullability annotation (none in its CHANGELOG); wrappers use `Option<NonNull<T>>`, `Option<&T>`, `Option<extern "C" fn>` | raw pointers (nullable); function pointers as `Option<unsafe extern "C" fn>` |
| .NET | win32metadata `[Optional]` ("may be NULL"), `[Reserved]` ("always expect a NULL") → CsWin32 overloads | `T*`/`IntPtr`, nullable; `ref` parameters are never null |
| Java | none | every address may be `MemorySegment.NULL`; a Java `null` argument throws `NullPointerException` |

```c
NS_ASSUME_NONNULL_BEGIN            // unannotated pointers inside are non-null
- (nullable MyListItem *)itemWithName:(NSString *)name;
NS_ASSUME_NONNULL_END
// Swift: func item(withName name: String) -> MyListItem?
```

"If no nullability information is provided for a type, Swift ... imports the
type as an implicitly unwrapped optional"; "typedef types aren't assumed to be
nonnull, even within audited regions". bindgen output for a C function
pointer: `::std::option::Option<unsafe extern "C" fn(x: c_int, y: c_int) ->
c_int>`. bindgen's CHANGELOG has no C nullability entry (0.73.0 maps C++
references to `NonNull`). Rust guarantees `Option<T>` has the same ABI as `T`
for references, `Box`, `NonNull`, `extern "C" fn` and `NonZero*`.

Sources: https://developer.apple.com/documentation/swift/designating-nullability-in-objective-c-apis ·
https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0054-abolish-iuo.md ·
https://doc.rust-lang.org/std/option/index.html#representation ·
https://github.com/rust-lang/rust-bindgen/blob/main/bindgen-tests/tests/expectations/tests/func_ptr.rs ·
https://github.com/microsoft/win32metadata/blob/main/docs/projections.md ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html.

**Best design.** Three states (non-null, nullable, unspecified) with audited
regions so a vendor annotates only the exceptions. Unspecified must never be
undefined behaviour: either nullable (forcing a check) or a checked non-null
that traps on NULL with the boundary named. Swift's implicitly unwrapped
optional is the pragmatic default for unannotated headers; for a language
whose types already include `| null`, importing unspecified as nullable is
the stricter and still cheap choice.

**Pitfalls.**
- Swift: a nil reaching an IUO traps at use, far from the C call that
  produced it.
- API notes `NullabilityOfRet` bug (§1).
- Rust: constructing a reference or `extern fn` from NULL "is undefined
  behavior" (nomicon nullable-pointer section).

---

## 11. Enums, flags, constants, macros and `static inline` functions

| Toolchain | Enums | Flags | Object-like macros | Function-like macros | `static inline` |
|---|---|---|---|---|---|
| Swift | unannotated → struct with `rawValue`; `enum_extensibility(closed)` → frozen enum; open → non-frozen (`@unknown default`) | `NS_OPTIONS`/`flag_enum`, or API notes `SwiftWrapper: struct` + `SwiftConformsTo: Swift.OptionSet` | imported as constants (literals, and operators over them) | not imported | imported and compiled by the caller ("require the caller to emit a definition") |
| Rust | default: integer constants + type alias; `rustified_enum` (UB on unknown values), `rustified_non_exhaustive_enum`, `newtype_enum`, `constified_enum_module` | `bitfield_enum` | `pub const`; `clang_macro_fallback` (0.70+) evaluates what `CExpr` cannot | not supported (tracking issue #753) | `wrap_static_fns` (0.64, non-experimental 0.71) emits a C file of wrappers to compile; or `generate_inline_functions` with `-fkeep-inline-functions` |
| .NET | C# enums hold any value of the underlying type | `[Flags]` | win32metadata constants; `[Constant]` for "Inline functions that return constants" | n/a | not reachable by P/Invoke, which binds exported symbols (not separately sourced); the win32metadata scraper runs with `exclude-funcs-with-body` |
| Java | jextract: top-level int getters, like C | plain ints | getters for numeric, string and pointer macros | "not supported by jextract" | bindings generated but the symbol is missing at run time (2022 reports); write a wrapper library |

```c
typedef enum __attribute__((enum_extensibility(closed))) WGPUAdapterType {
    WGPUAdapterType_DiscreteGPU, /* ... */ } WGPUAdapterType;   // Swift: frozen enum
#define MAX_RESOLUTION 1268                                      // Swift: let MAX_RESOLUTION = 1268
#define HALF_RESOLUTION (MAX_RESOLUTION / 2)                     // Swift: let HALF_RESOLUTION = 634
```

```rust
pub const foo_FOO_A: foo__bindgen_ty_1 = 0;       // bindgen default enum output
pub type foo__bindgen_ty_1 = ::std::os::raw::c_uint;
```

SE-0192: "an otherwise-unannotated `NS_ENUM` will be imported as non-frozen";
switching over an unexpected value of a frozen `@objc` enum "will always
result in a trap rather than 'undefined behavior'" (whether imported C enums
take the same path is **(unverified)**). bindgen: `rustified_enum` — "**Use
this with caution**, creating an instance of a Rust `enum` with an invalid value
will cause undefined behaviour." The Rust reference: "using a field-less enum in
FFI to model a C `enum` is often wrong". C#: "The default value of an enumeration
type `E` is the value produced by expression `(E)0`, even if zero doesn't have
the corresponding enum member"; `(Season)4` prints `4`.

Sources: https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ·
https://developer.apple.com/documentation/swift/using-imported-c-macros-in-swift ·
https://developer.apple.com/documentation/swift/grouping-related-objective-c-constants ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0192-non-exhaustive-enums.md ·
https://clang.llvm.org/docs/AttributeReference.html (`enum_extensibility`, `flag_enum`) ·
https://docs.rs/bindgen/latest/bindgen/struct.Builder.html ·
https://rust-lang.github.io/rust-bindgen/faq.html ·
https://github.com/rust-lang/rust-bindgen/issues/753 ·
https://doc.rust-lang.org/reference/type-layout.html ·
https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum ·
https://github.com/microsoft/win32metadata/blob/main/docs/projections.md ·
https://github.com/openjdk/jextract/blob/master/doc/GUIDE.md ·
https://mail.openjdk.org/pipermail/jextract-dev/2022-September/000423.html.

**Best design.** Closed enums (stated by `enum_extensibility(closed)` or the
sidecar) become exhaustive enums whose decoding of an unknown value traps;
everything else stays an integer newtype with named constants, so unknown
values are representable. Flags become option sets. Object-like macros are
evaluated by the C compiler itself (bindgen's clang fallback). `static inline`
functions are compiled from the header and inlined at the call (Swift's
design); an out-of-line wrapper is the fallback, at a cost the bindgen FAQ
names: these functions "tend to be hot".

**Pitfalls.**
- Rust: `rustified_enum` over a C enum that can grow is undefined behaviour on
  the first new value.
- bindgen: function-like macros vanish silently; RHEL-28918 reports constants
  defined through them disappearing from the bindings and breaking a build
  (https://issues.redhat.com/browse/RHEL-28918; read via a search summary, the
  issue itself was not opened).
- jextract: one `static inline` function made the generated header class fail
  at run time with `UnsatisfiedLinkError` (panama-dev, 2022); whether a later
  jextract fixed it is **(unverified)**.
- Swift non-frozen enums need `@unknown default`; frozen ones must truly never
  grow (SE-0192 calls an unrecompiled client of a grown frozen Swift enum
  undefined behaviour).

---

## 12. Variadic functions such as `printf`

| Toolchain | Support | Type check of the variadic tail |
|---|---|---|
| Swift | `...` functions "are not imported"; `va_list` ones are, called with `withVaList`/`getVaList` and `CVarArg` | `CVarArg` conformance |
| Rust | declare `fn printf(fmt: *const c_char, ...) -> c_int;` in an `unsafe extern` block; defining variadics is not stable | error E0617 rejects non-promoted types (`f32` must be `c_double`) |
| .NET | "The 'official way' is it is not supported"; the supported workaround is a native shim; fixed-signature P/Invokes work "in some cases but not all" | none |
| Java | link one "specialized form" per call shape with `Linker.Option.firstVariadicArg(i)` | the linker rejects layouts of non-promoted C types (`_Bool`, `char`, `short`, `float` on Linux/x64) |

```swift
withVaList([sqrt(2.0)]) { va in vprintf("√2 ≅ %g\n", va) }   // after Apple's vasprintf example
```

```rust
unsafe extern "C" { fn printf(format: *const c_char, ...) -> c_int; }
unsafe { printf(c"%f\n".as_ptr(), 0f64) };        // 0f32 is error E0617
```

```java
MethodHandle printf = linker.downcallHandle(linker.defaultLookup().findOrThrow("printf"),
    FunctionDescriptor.of(JAVA_INT, ADDRESS, JAVA_INT, JAVA_INT, JAVA_INT),
    Linker.Option.firstVariadicArg(1));             // javadoc example
```

Sources: https://developer.apple.com/documentation/swift/using-imported-c-functions-in-swift ·
https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md ("there
are no technical reasons why they can't be imported") ·
https://doc.rust-lang.org/reference/items/external-blocks.html ·
https://doc.rust-lang.org/error_codes/E0617.html ·
https://github.com/dotnet/runtime/issues/48752 ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.Option.html
("always use this linker option when linking a variadic function, even if no
variadic argument is passed").

**Best design.** Specialize per call site: the binding names the fixed part,
the compiler derives the tail's C types from the arguments, applies C's
default argument promotions, and rejects a type C cannot pass (Java's and
Rust's checks). Then emit a real variadic call so the platform ABI is right by
construction. A `format(printf)` attribute could additionally check the
format string against the tail (not researched here).

**Pitfalls.**
- Apple arm64 passes variadic arguments differently (on the stack), so a
  fixed-signature declaration of a variadic function breaks there; a reporter
  hitting it with SQLitePCL.raw wrote that "it breaks horribly on ARM64 ABI on
  iOS/macOS" (dotnet/runtime#48752, 2021-02-25).
- Rust: the `safe` qualifier on a variadic extern function is wrong unless the
  function "will not access the variadic arguments at all" (reference).
- Java: the variadic index must be given even with an empty tail, "as this
  might still affect the calling convention on certain platforms".

---

## 13. Safety checking

| Toolchain | Static | Dynamic | Not checked | Escape hatch |
|---|---|---|---|---|
| Swift | `~Escapable`/`@lifetime` for `Span`; dangling-pointer warnings; opt-in strict memory safety (6.2) flags every unsafe use; imported C structs containing pointers inferred `@unsafe` | `Span` bounds on every access; exclusivity; IUO nil traps; checked safe-overload counts | anything through `Unsafe*Pointer`; C's retention of pointers | `unsafe` expression (6.2), `@unsafe`/`@safe`, API notes `SwiftSafety` |
| Rust | borrow checker for references and lifetimes in wrappers; `improper_ctypes` lint; bindgen layout asserts; `unsafe_op_in_unsafe_fn` warns in 2024 | none by default (no bounds on raw pointers) | extern signatures, raw pointer validity, C retention | `unsafe extern` blocks, `unsafe {}`; `safe fn` items assert a C function is safe for all inputs; `#[unsafe(no_mangle)]` |
| .NET | `LibraryImport` analyzers (SYSLIB1050–1069); requires `AllowUnsafeBlocks`; explicit marshalling for `bool`/`char`/`string` | marshalling stubs; SafeHandle ref counts; `GCHandle.Alloc` rejects non-blittable pinning | signatures vs the native export, native retention | `unsafe` code, `DisableRuntimeMarshalling`, `Dangerous*` SafeHandle methods |
| Java | none on signatures ("the linker runtime cannot validate linkage requests") | spatial and temporal bounds on every segment access; thread confinement; liveness of downcall arguments | descriptor vs C prototype; `reinterpret`ed sizes | restricted methods (`downcallHandle`, `upcallStub`, `reinterpret`, `libraryLookup`) gated by `--enable-native-access`; JDK 24+ warns by default, `deny` planned |

```swift
// -strict-memory-safety (SE-0458, Swift 6.2)
return unsafe Int(bitPattern: malloc(size))      // acknowledged; no warning
```

```rust
unsafe extern "C" {                               // Rust 2024 (edition guide)
    pub safe fn sqrt(x: f64) -> f64;              // callable without unsafe
    pub unsafe fn strlen(p: *const std::ffi::c_char) -> usize;
}
```

```sh
java --enable-native-access=ALL-UNNAMED MyApp          # allow restricted methods
java --illegal-native-access=deny MyApp                # future default
```

SE-0458: C pointers import as `Unsafe*Pointer`, so functions using them are
implicitly `@unsafe`; "A C function with no pointer types is treated as safe";
C enums are never inferred `@unsafe`. Rust 2024: "it is the responsibility of
the author of the `extern` block to ensure that the signatures are correct";
`cargo fix --edition` "will not be able to verify that the signatures in the
`extern` block are correct". .NET: "the use of `LibraryImportAttribute`
requires an explicit declaration rather than relying on default settings. This
design is intentional". Java: "Arenas provide strong temporal safety
guarantees"; a zero-length segment "cannot be used without explicit intent".

Sources: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0458-strict-memory-safety.md ·
https://github.com/swiftlang/swift-evolution/blob/main/proposals/0447-span-access-shared-contiguous-storage.md ·
https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html ·
https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-op-in-unsafe-fn.html ·
https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html ·
https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices ·
https://learn.microsoft.com/en-us/dotnet/standard/native-interop/disabled-marshalling ·
https://docs.oracle.com/en/java/javase/25/core/restricted-methods.html ·
https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html.

**Best design.** Check the binding against the real header at build time
(bindgen's layout asserts, cxx's static assertions; nts's witness), so the one
thing none of the runtimes can check is checked before the program runs. Hand
user code checked views (Swift `Span`, Java segments): lifetimes proved
statically where the binding states them, bounds checked at run time and
removable where proved. Keep the unsafe surface small, visible and opt-in
(Rust's `unsafe extern`/`safe fn`, Swift's `unsafe` expression, Java's
restricted methods).

**Pitfalls.**
- Java: an invalid descriptor "is unspecified and can lead to JVM crashes";
  an upcall returning a segment whose memory dies "can lead to unspecified
  behavior" (Linker safety section).
- Rust: `safe fn` is an unchecked claim; marking a pointer-taking function
  `safe` reintroduces UB in safe code.
- Swift: strict memory safety is opt-in and produces warnings only; it does not
  change semantics (SE-0458).
- Swift `UnsafeBufferPointer` overloads add bounds checks but "without
  lifetime safety" (safe-interop page).

---

## What can be generated, and what must be stated

A synthesis of the sections above (not a claim from any one source).

| Fact | From the header alone | From a standard annotation, when present | Otherwise stated by a person |
|---|---|---|---|
| Symbol, prototype, struct/union layout, enum values | yes | — | — |
| Object-like macro constants | yes, with the C compiler's evaluator | — | — |
| `static inline` bodies | yes, if the backend compiles the header | — | — |
| Nullability | no | `_Nonnull`/`_Nullable`/`_Null_unspecified`, `assume_nonnull`; SAL `_In_opt_` on Windows (mapping unverified) | yes |
| Pointer + count relation, elements vs bytes | no | `__counted_by`/`__sized_by`/`__counted_by_or_null`; SAL buffer annotations on Windows (mapping unverified) | yes |
| Callee keeps a pointer argument | no | `__noescape`, `__lifetimebound`, `lifetime_capture_by` | yes |
| Borrowed result's lifetime | no | `__lifetimebound` | yes |
| Ownership of a result, release function | no (except CF naming rules) | `cf_returns_retained`, `swift_attr("returns_retained")`, `SWIFT_SHARED_REFERENCE`, `swift_attr("destroy:fn")` | usually |
| Error convention | no | `swift_error(...)` | usually |
| Enum open/closed, flags | no | `enum_extensibility`, `flag_enum` | otherwise |
| Callback lifetime class, context and destroy parameters | no | only "during the call" (`__noescape`) | usually |
| Thread affinity | no | no standard annotation found | yes |
| Variadic call shapes | no | `format(printf)` for format strings | per call site |

For nts specifically: its declared-module design (`c:<name>` ambient modules,
JSDoc tags such as `@ntsNoEscape` and `@ntsThrows`, the binding vocabulary,
`local<T>()`, `Closure`/`ScopedClosure`/`OnceClosure`, and the witness that
checks bindings against headers; `docs/targets/native.md`) already matches the
best design on retention, callbacks and header checking. The survey points at
three gaps it could close by reading facts rather than requiring them to be
restated: consuming Clang's standard annotations (nullability,
`__counted_by`/`__sized_by`, `__noescape`, `__lifetimebound`,
`enum_extensibility`, `flag_enum`, `swift_attr` ownership) when headers carry
them; a module-keyed sidecar in the API-notes shape for third-party facts; and
the ownership vocabulary ResourceFlow is to supply (owned/borrowed/shared,
release and retain functions, fallible close).

---

## Unverified or open items

- Whether Swift 6.3 or 6.4 enabled `SafeInteropWrappers` by default.
- The first Swift release containing the `~Copyable` POD-deinit fix
  (swiftlang/swift#89686, merged to `main` 2026-06-09).
- Swift: that a `@convention(c)` type cannot be `throws` (inferred from the
  diagnostic "throwing function types cannot be represented in …"); thread
  rules for C callbacks; whether unexpected values of closed C enums trap; that
  `deinit` cannot throw (language rule, not re-sourced).
- Swift `swift_error`: which error-parameter types a plain C function may use
  (`CFErrorRef *` assumed) and the exact imported signature.
- bindgen function-like macro support status (issue #753).
- .NET: SAL → `In`/`Out`/`Optional`/`NativeArrayInfo`/`MemorySize` derivation in
  win32metadata (only `_retval_` → `RetVal` is documented; the scraper's SAL
  flags were verified); default span marshalling without `[MarshalUsing]`;
  thread attachment for reverse P/Invoke on modern .NET.
- Java: automatic attachment of native threads for upcalls in JDK 25 (only
  2019–2022 mailing-list reviews, read via search summaries); the 2022
  jextract `static inline` reports were likewise read via search summaries.
- Java: order of several arena cleanup actions and the effect of a cleanup that
  throws; jextract's current `static inline`
  behaviour; FFM changes in JDK 26/27 (none found); the
  `reinterpret(Long.MAX_VALUE).getString(0)` idiom as a documented pattern.
- CVEs: only RUSTSEC-2020-0014 (rusqlite, CVE-2020-35866…35873) was looked up;
  no systematic CVE search was done for the other toolchains.

## Sources

Swift and Clang
- https://github.com/swiftlang/swift/blob/main/docs/HowSwiftImportsCAPIs.md
- https://www.swift.org/documentation/cxx-interop/safe-interop/
- https://www.swift.org/documentation/cxx-interop/ · https://www.swift.org/documentation/cxx-interop/status/
- https://www.swift.org/blog/improving-usability-of-c-libraries-in-swift (2026-01-22)
- https://www.swift.org/blog/swift-6.2-released/ · https://www.swift.org/blog/swift-6.3-released/ · https://www.swift.org/blog/swift-6.4-released/
- https://www.swift.org/blog/swift-5-exclusivity/
- https://github.com/swiftlang/swift/blob/main/CHANGELOG.md
- https://github.com/swiftlang/swift/pull/83364 · https://github.com/swiftlang/swift/pull/83677 · https://github.com/swiftlang/swift/pull/89686
- https://github.com/swiftlang/swift/blob/main/include/swift/AST/DiagnosticsSIL.def
- https://github.com/swiftlang/swift/blob/main/userdocs/diagnostics/temporary-pointers.md
- https://github.com/swiftlang/swift/blob/main/stdlib/public/core/CString.swift
- SE-0054, SE-0192, SE-0245, SE-0322, SE-0377, SE-0390, SE-0447, SE-0458, SE-0485: https://github.com/swiftlang/swift-evolution/tree/main/proposals
- https://developer.apple.com/documentation/swift/calling-functions-with-pointer-parameters
- https://developer.apple.com/documentation/swift/using-imported-c-functions-in-swift
- https://developer.apple.com/documentation/swift/using-imported-c-structs-and-unions-in-swift
- https://developer.apple.com/documentation/swift/using-imported-c-macros-in-swift
- https://developer.apple.com/documentation/swift/grouping-related-objective-c-constants
- https://developer.apple.com/documentation/swift/designating-nullability-in-objective-c-apis
- https://developer.apple.com/documentation/swift/working-with-core-foundation-types
- https://developer.apple.com/documentation/swift/unmanaged
- https://developer.apple.com/documentation/swift/withunsafepointer(to:_:)-35wrn
- https://developer.apple.com/forums/thread/674633 (Apple DTS, "The Peril of the Ampersand")
- https://forums.swift.org/t/c-annotations-counted-by-and-noescape-not-producing-span-consuming-function-signatures/83333
- https://github.com/apple/swift-system
- https://clang.llvm.org/docs/APINotes.html · https://clang.llvm.org/docs/AttributeReference.html · https://clang.llvm.org/docs/BoundsSafety.html
- https://lists.llvm.org/pipermail/cfe-commits/Week-of-Mon-20250811/741254.html (SwiftDestroyOp)

Rust
- https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-extern.html (+ unsafe-op-in-unsafe-fn, unsafe-attributes, index)
- https://doc.rust-lang.org/reference/items/external-blocks.html · https://doc.rust-lang.org/reference/type-layout.html
- https://doc.rust-lang.org/nomicon/ffi.html
- https://blog.rust-lang.org/2024/09/05/Rust-1.81.0/
- std docs: option (representation), slice::from_raw_parts, ffi::CStr, ffi::CString, mem::MaybeUninit, mem::forget, io::Error — https://doc.rust-lang.org/std/
- https://doc.rust-lang.org/error_codes/E0617.html · https://doc.rust-lang.org/rustc/lints/listing/warn-by-default.html
- https://rust-lang.github.io/rust-bindgen/ (FAQ, flexible array members) · https://docs.rs/bindgen/latest/bindgen/struct.Builder.html
- https://github.com/rust-lang/rust-bindgen/blob/main/CHANGELOG.md · https://github.com/rust-lang/rust-bindgen/issues/753
- https://docs.rs/rusqlite/latest/rusqlite/ · https://github.com/rusqlite/rusqlite (src/inner_connection.rs, src/busy.rs)
- https://rustsec.org/advisories/RUSTSEC-2020-0014.html
- https://cxx.rs/ · https://cxx.rs/extern-c++.html · https://cxx.rs/binding/result.html · https://cxx.rs/bindings.html

.NET
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/custom-marshalling-source-generation
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/custom-marshaller-shapes
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/best-practices
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/default-marshalling-for-strings
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/default-marshalling-behavior
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/exceptions-interoperability
- https://learn.microsoft.com/en-us/dotnet/standard/native-interop/disabled-marshalling
- API: SafeHandle, SafeHandle.ReleaseHandle, UnmanagedCallersOnlyAttribute, Marshal.GetLastPInvokeError, ReadOnlySpanMarshaller<T,TUnmanagedElement>, GC.AllocateArray, GCHandle<T> — https://learn.microsoft.com/en-us/dotnet/api/
- https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum
- https://github.com/dotnet/runtime/blob/main/docs/design/libraries/LibraryImportGenerator/Compatibility.md
- https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Runtime/InteropServices/Marshalling/ReadOnlySpanMarshaller.cs
- https://github.com/dotnet/runtime/issues/48752 · https://github.com/dotnet/runtime/issues/97952
- https://github.com/microsoft/CsWin32 (README, docfx/docs/getting-started.md, templates/HRESULT.cs)
- https://github.com/microsoft/win32metadata (docs/projections.md, docs/architecture.md, scraper baseSettings.rsp)

Java FFM
- https://openjdk.org/jeps/454
- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Arena.html
- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.html
- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/Linker.Option.html
- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/foreign/MemorySegment.html
- https://docs.oracle.com/en/java/javase/25/core/foreign-function-and-memory-api.html (upcalls, restricted methods)
- https://github.com/openjdk/jextract (README, doc/GUIDE.md)
- https://mail.openjdk.org/pipermail/panama-dev/2019-June/005779.html · https://mail.openjdk.org/pipermail/panama-dev/2021-July/014507.html
- https://mail.openjdk.org/pipermail/jextract-dev/2022-September/000423.html · https://mail.openjdk.org/pipermail/panama-dev/2022-September/017740.html
