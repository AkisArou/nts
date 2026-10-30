# Research for nts’s C interop design

**Research snapshot: 29 October 2026, UTC.** Numbers in **[brackets]** refer to the thirteen concepts in the handoff. Examples are short binding fragments, with imports, library loading and surrounding application logic omitted where appropriate; they were not executed.

I read the four nts documents in the requested order. The starting point for this report is the current `c:`/`c:types` interface, the header-compiled ABI witness, the existing GIR integration and GObject counting, and the planned ResourceFlow prerequisite for whole-library binding. I treat the C number mapping and that prerequisite as settled. The notebook is historical background, not evidence of current behavior. Sources: [native interop](https://github.com/AkisArou/nts/blob/main/docs/targets/native.md#calling-c), [C headers](https://github.com/AkisArou/nts/blob/main/docs/targets/c-headers.md), [GTK](https://github.com/AkisArou/nts/blob/main/docs/targets/gtk.md), [earlier notebook](https://github.com/AkisArou/nts/blob/main/docs/records/notebooks/native-interop.md).

A recurring distinction in the findings is between **calling a function with the right ABI**, **knowing its semantic contract**, and **checking that callers honor that contract**. The systems below automate different portions of those three jobs.

# A. How JavaScript runtimes and dynamic languages call C

## A.1 Bun: `bun:ffi`

**Version:** rolling documentation advertising Bun **1.4.4**, plus inspected `main` type declarations. This does not establish that every `main` feature is in the published 1.4.4 package.

**[1,2,11,13]** Bindings are authored symbol descriptors: `dlopen(path, {name: {args, returns}})`. The inspected public vocabulary describes scalar and pointer calls, without a general struct-by-value descriptor. Record storage therefore needs explicit native memory representation or a C adapter. These declarations are not checked against the library’s headers. Incorrect addresses and use after unloading remain native failure modes. [Official FFI documentation](https://bun.com/docs/runtime/ffi); [type declarations](https://github.com/oven-sh/bun/blob/main/packages/bun-types/ffi.d.ts). [Bun Docs](https://bun.com/docs/runtime/ffi?utm_source=chatgpt.com)

**[3,4,6]** A notable current feature is `buffer_length`: pass the **same view** for the buffer and length parameters, and Bun obtains both at call time. The length is **bytes**, passed as an unsigned 64-bit value. This avoids separately reading a potentially stale view length, but does not establish the C function’s capacity requirements or permission to retain the storage. It is engine-native and unavailable inside `cc()`. [Inspected declarations](https://github.com/oven-sh/bun/blob/main/packages/bun-types/ffi.d.ts).

```ts
// C: void consume_bytes(const unsigned char *, uint64_t);
const lib = dlopen(path, {
  consume_bytes: { args: ["buffer", "buffer_length"], returns: "void" },
});
lib.symbols.consume_bytes(bytes, bytes);
```

**[5,7,8,10]** Current `cstring` arguments accept JS strings and transcode them to call-scoped, NUL-terminated UTF-8. `CString` produces a JS copy. String conversion does not select or invoke a library deallocator: an owned return needs its address preserved and its release function called. An address returned as an alias of a temporary string argument has a particularly short validity window. Pointer/string results can be `null`; status interpretation and cleanup remain application work. [Bun](https://bun.com/reference/bun/ffi/CString?utm_source=chatgpt.com)

Callbacks and variadics are compared below.

## A.2 Deno: `Deno.dlopen`

**Version:** current documentation and repository snapshot whose CLI manifest declares **2.9.8**.

**[1,2,4,6,10,13]** Deno also takes handwritten symbol descriptors. A `buffer` parameter accepts a typed array; pointer results are opaque pointer objects or `null`. Struct-by-value descriptions enumerate fields in order, with automatic padding; arguments are byte storage and results are `Uint8Array` copies. Deno does not turn them into named-field JS objects. Output buffers and pointer slots must be provided explicitly, with separately supplied counts. The `--allow-ffi` permission controls access to native code; it does not make that code memory-safe. [FFI guide](https://docs.deno.com/runtime/fundamentals/ffi/), [type and struct semantics](https://docs.deno.com/api/deno/about/#supported-types). [Deno Docs](https://docs.deno.com/runtime/fundamentals/ffi/?utm_source=chatgpt.com)

```ts
const libc = Deno.dlopen(path, {
  strlen: { parameters: ["buffer"], result: "usize" },
});
const n = libc.symbols.strlen(new TextEncoder().encode("nts\0"));
```

**[3,5,7,8]** Strings require explicit encoding/termination; `UnsafePointerView.getCString()` decodes a C string. A copied JS string does not free the original allocation. Retained native pointers require an application-managed lifetime, and raw pointer views do not supply ownership or bounds proofs. Error results and native release functions are separately bound and interpreted. [FFI API](https://docs.deno.com/api/deno/ffi/). [Deno Docs](https://docs.deno.com/api/deno/ffi/?utm_source=chatgpt.com)

A deliberate tradeoff appears in callbacks: `UnsafeCallback` is **not automatically deallocated**, to avoid premature collection causing use-after-free. Forgetting `close()` therefore leaks its native resource. [Deno Docs](https://docs.deno.com/api/deno/about/?utm_source=chatgpt.com)

## A.3 Node-API

**Version:** Node **26.13.0** documentation, plus current `node-addon-api` sources.

**[1,2,4–8,10,11,13]** Node-API is a stable interface for **native addon code**, rather than a C-header FFI. Native glue includes the real headers and decides how JS objects, structs, strings, outputs, errors and handles correspond. `napi_get_buffer_info` returns a byte length; `napi_get_typedarray_info` returns an element count. String APIs explicitly distinguish UTF-8, UTF-16 and Latin-1. The glue decides whether an output becomes a JS return value, object, tuple-like array, exception or `null`. [Node-API manual](https://nodejs.org/api/n-api.html). [Node.js v26.13.0 Documentation](https://nodejs.org/api/n-api.html?utm_source=chatgpt.com)

```cpp
auto bytes = info[0].As<Napi::Buffer<uint8_t>>();
native_consume(bytes.Data(), bytes.Length());  // call-scoped use
```

**[3,8]** A `napi_ref` can preserve a JS value beyond the native method, while `napi_wrap` associates native state and a finalizer with an object. Neither supplies the C library’s retention protocol automatically. External buffers require their underlying storage to survive as long as the JS buffer. `node-addon-api` also has `NewOrCopy`: on a copying path, its supplied cleanup can happen immediately, which differs from cleanup tied to eventual GC. [Buffer documentation](https://github.com/nodejs/node-addon-api/blob/main/doc/buffer.md).

**Practical failure:** keeping a C address without the corresponding JS/native lifetime arrangement can leave dangling storage; relying on finalizers alone does not describe dependent handles or fallible release. Node-API’s exception and thread facilities still require native glue to translate the particular library’s protocol. [Error handling](https://github.com/nodejs/node-addon-api/blob/main/doc/error_handling.md). [GitHub](https://github.com/nodejs/node-addon-api/blob/main/doc/error_handling.md?utm_source=chatgpt.com)

## A.4 Koffi

**Version:** **3.3.5**, released **28 October 2026**.

**[1,2,4,6,10,13]** Koffi accepts handwritten C-like prototypes and type constructors. Structs and arrays can be marshalled from JS objects; ordinary object/array arguments default to input conversion. `_Out_`, `_Inout_`, `koffi.out()` and `koffi.inout()` request copying back. A scalar output can use a one-element JS array. Structs, packed structs and unions have explicit descriptions; an output union still requires the caller to choose the meaningful member. Counts and sentinels are generally supplied by the binding author. [Koffi](https://koffi.dev/output?utm_source=chatgpt.com)

**[3]** Its documentation explicitly restricts directly passed Buffers/TypedArrays to the native call’s duration. For storage retained or modified later by C, it prescribes `koffi.alloc(type, count)` and explicit release. [Koffi](https://koffi.dev/output?utm_source=chatgpt.com)

**[5,7,8]** String types support UTF-8, UTF-16, UTF-32 and platform `wchar_t`. Ordinary string conversion can lose the returned allocation’s address and leak it. Disposable types attach cleanup **after conversion**; `str!` uses the standard C allocator’s `free`, while a custom disposable can use the library’s own destructor. A mismatched Windows CRT allocator is explicitly documented as undefined behavior. `koffi.errno()` exposes errno; it does not choose the function’s failure predicate. [Koffi](https://koffi.dev/values?utm_source=chatgpt.com)

```js
const duplicate = libc.func("str! strdup(str input)");
const copy = duplicate("nts"); // copy into JS, then free original
```

This is also an actively maintained implementation with real defects: 3.3.5 fixed a string-array leak and `countedBy` confusion. Those are fixed issues, not claims that the current release still contains them. [Changelog](https://koffi.dev/changelog). [Koffi](https://koffi.dev/changelog?utm_source=chatgpt.com)

## A.5 Older `node-ffi-napi`

**Version:** inspected `master` snapshot, whose package version is **4.0.3**; not verified byte-for-byte against that published package.

**[1–8,10,13]** Signatures are handwritten return/argument type lists. `ref-napi` represents pointers using Buffers; `ref.alloc()` supplies output slots. Struct/array descriptions come from companion packages. Native status interpretation, buffer/count relationships, allocation families and retained-pointer lifetimes remain binding code. UTF-8 C strings use explicit conversion helpers. `ref.NULL` is a Buffer object, so testing JS truthiness is insufficient; use the pointer-null test. [ffi-napi](https://github.com/node-ffi-napi/node-ffi-napi), [ref-napi](https://github.com/node-ffi-napi/ref-napi). [GitHub](https://github.com/node-ffi-napi/node-ffi-napi?utm_source=chatgpt.com)

```js
const exponent = ref.alloc("int");
const fraction = libm.frexp(8.0, exponent);
const e = exponent.deref();
```

Two unusually direct warnings matter. The project README says its GC and multithreading behavior is poorly defined and recommends avoiding multithreaded use. The ref ecosystem also distinguishes compatible `ref-struct-di`/`ref-array-di` from incompatible combinations that can crash. These are stronger cautions than merely saying native code is unsafe. [GitHub](https://github.com/node-ffi-napi/node-ffi-napi?utm_source=chatgpt.com)

## A.6 LuaJIT FFI

**Version:** current rolling **LuaJIT 2.1** documentation.

**[1,2,4,6,10,11,13]** `ffi.cdef` parses C declarations; `ffi.new` allocates native cdata structs and arrays. `ffi.new("int[1]")` is a common output slot. The parser is not a C preprocessor: enums/static constants work, but ordinary macros need preprocessing or replacement, and inline function bodies are ignored. Native pointers remain unchecked for general bounds, lifetime and prototype correctness. [API](https://luajit.org/ext_ffi_api.html), [semantics](https://luajit.org/ext_ffi_semantics.html). [luajit.org](https://luajit.org/ext_ffi_api.html?utm_source=chatgpt.com)

**[3,5,8]** Argument objects survive the call, but the GC does not trace arbitrary pointers stored inside C records. A cdata pointer to another cdata allocation does not automatically retain that allocation. Lua strings are byte strings; `ffi.string(p, n)` copies bytes and does not free `p`. `ffi.gc` attaches a destructor; explicit release removes the finalizer before freeing. [luajit.org](https://luajit.org/ext_ffi_api.html?utm_source=chatgpt.com)

```lua
ffi.cdef[[void *malloc(size_t); void free(void *);]]
local p = ffi.gc(ffi.C.malloc(64), ffi.C.free)
assert(p ~= nil)
ffi.C.free(ffi.gc(p, nil))
```

**[7]** `ffi.errno()` preserves the relevant errno value across internal VM activity, but the caller must first establish that the C return denotes an error. **Footgun:** an implicitly created callback is permanently anchored until termination; repeated creation can exhaust a finite callback pool. Explicit callback objects can be freed. [luajit.org](https://luajit.org/ext_ffi_api.html?utm_source=chatgpt.com)

## A.7 Python `ctypes`

**Version:** CPython **3.14** documentation and branch source.

**[1–4,6,10,13]** `argtypes`/`restype` are handwritten; omitted `restype` assumes C `int`. `Structure`, `Union`, arrays and `byref` describe native storage and output slots. NULL dereference through the Python pointer API is checked, but invalid non-NULL pointers or native accesses can crash. Nested structure fields are **views**: the manual’s field-swap example overwrites both fields because the intermediate objects alias storage. [Python 3.14.10 documentation](https://docs.python.org/3.14/library/ctypes.html?utm_source=chatgpt.com)

**[5,7,8]** `c_char_p` uses bytes, while `c_wchar_p` uses native wide characters. A `c_char_p` result converts to Python bytes, losing the allocation address needed for cleanup. `use_errno`, `errcheck` and output `paramflags` support authored conventions. [Python 3.14.10 documentation](https://docs.python.org/3.14/library/ctypes.html?utm_source=chatgpt.com)

```python
lib.strdup.argtypes, lib.strdup.restype = [C.c_char_p], C.c_void_p
lib.free.argtypes = [C.c_void_p]
p = lib.strdup(b"nts")
if not p: raise MemoryError()
try: value = C.string_at(p)
finally: lib.free(p)
```

The implementation reports callback exceptions as unraisable errors rather than converting them into a library-specific C failure. It also contains deliberate lifetime retention for some callback-returned strings, with a memory-leak warning. [CPython callback implementation](https://github.com/python/cpython/blob/3.14/Modules/_ctypes/callbacks.c).

## A.8 Python `cffi`

**Version:** stable **2.1.1**; rolling documentation identifies **2.2.0.dev0**.

**[1,2,11,13]** CFFI distinguishes ABI mode (`cdef` + `dlopen`) from API mode, which compiles C against included headers. API mode lets the compiler determine partial struct layouts, enum values and constants, and compile wrappers. ABI mode relies much more directly on the author’s declaration accuracy. Neither obtains ownership from the C type alone. [Declaration modes](https://cffi.readthedocs.io/en/latest/cdef.html). [CFFI 2.2.0.dev0 documentation](https://cffi.readthedocs.io/en/latest/cdef.html?utm_source=chatgpt.com)

**[3–6,8,10]** `ffi.new` allocates native storage; pointer slots express outputs. `ffi.from_buffer` supplies zero-copy access and retains the source buffer while its cdata owner survives; an unrelated cast pointer is not an equivalent ownership root. `ffi.buffer(p, n)` takes bytes, whereas a typed array count is elements. `ffi.string` copies rather than frees. `ffi.gc` adds cleanup, and `ffi.release` permits deterministic release; subsequent use remains the caller’s error. PyPy finalizer timing/thread behavior is explicitly unsuitable for some scarce resources. [CFFI 2.2.0.dev0 documentation](https://cffi.readthedocs.io/en/latest/ref.html?utm_source=chatgpt.com)

```python
dst = ffi.new("unsigned char[]", capacity)
written = ffi.new("unsigned long *", capacity)
rc = lib.compress(dst, written, src, source_bytes)
if rc == lib.Z_OK: result = bytes(ffi.buffer(dst, written[0]))
```

**[7,9]** `ffi.errno` exposes the error channel. Callback error values and handlers are configurable. CFFI releases the GIL during C calls on GIL-enabled builds, so the GIL does not protect shared C data. Current CFFI also supports free-threaded Python; older blanket statements that callbacks are always globally serialized need qualification. [CFFI 2.1.1 documentation](https://cffi.readthedocs.io/en/stable/overview.html?utm_source=chatgpt.com)

## A.9 OCaml ctypes

**Version:** ctypes **0.24.0**, with OCaml **5.5** runtime documentation.

**[1,2,4,6,11,13]** Typed combinators describe signatures, such as `double @-> ptr int @-> returning double`. `Foreign` uses dynamic calls; Cstubs generates C, and `Cstubs_structs` obtains layouts/constants from headers. Native structures and arrays have typed field/access operations. That type discipline does not prove agreement with an independently declared C ABI or establish ownership. [OCaml Package](https://ocaml.org/p/ctypes-foreign/0.24.0/doc/ctypes-foreign/Foreign/index.html?utm_source=chatgpt.com)

```ocaml
let frexp = Foreign.foreign "frexp"
  (double @-> ptr int @-> returning double)
let exponent = allocate int 0
let fraction = frexp 8.0 exponent
```

**[3,5,8,10]** `string` copies into native temporary storage; direct `ocaml_string`/`ocaml_bytes` access is dangerous if callbacks or runtime-lock release allow GC movement. CArray/Bigarray storage and roots need lifetimes appropriate to retention. `string_opt`/`ptr_opt` express optional values. `Ctypes.Root.create/get/release` provides an explicit root-backed context handle; it does not turn an OCaml value into a C-layout record. [OCaml Package](https://ocaml.org/u/2d03d2b8fdb21b212587a08ddc44c690/ctypes/0.24.0/doc/ctypes/Ctypes/index.html?utm_source=chatgpt.com)

**[7]** `check_errno=true` raises when a function changes errno, even though a successful C function may legally do that. The documentation warns about this. Generated stubs can instead return errno alongside the value so an API-specific predicate decides whether it matters. [OCaml Package](https://ocaml.org/p/ctypes-foreign/0.24.0/doc/ctypes-foreign/Foreign/index.html?utm_source=chatgpt.com)

## A.10 Haskell FFI, hsc2hs and c2hs

**Version:** GHC **9.14.1**, base **4.22.0.0** documentation; c2hs **0.28.8** package documentation.

**[1,2,4,6,11]** Foreign imports are authored types. hsc2hs obtains C sizes, alignment, offsets and constants through C compilation; c2hs uses headers plus binding hooks to generate imports and marshalling. `Storable`, `alloca`, `peek` and `poke` describe native storage and outputs. Ordinary Haskell values are not automatically C structs; aggregate-by-value interfaces commonly need adapters. [haskell.org](https://www.haskell.org/onlinereport/haskell2010/haskellch8.html?utm_source=chatgpt.com)

**[3,13]** GHC’s `safe`/`unsafe` distinction concerns runtime interaction, including callbacks and GC. `unsafe` does not mean a checked memory-safe call: it prohibits re-entry, and GHC prevents GC during such calls. `safe` calls require the documented pinning and reachability arrangements. These restrictions are not comprehensively enforced by the type checker. [Glasgow Haskell Compiler 9.14.1 User's Guide](https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/ffi.html?utm_source=chatgpt.com)

**[5,7,8,10]** `withCString` scopes temporary storage; `newCString` requires release. Default CString conversion is locale-dependent, not universally UTF-8. `ForeignPtr` supplies finalization and call-duration rooting, while explicit structured cleanup supplies deterministic release. `nullPtr` remains possible. `Foreign.C.Error` offers predicates such as `throwErrnoIf`; GHC saves/restores errno for Haskell threads. [downloads.haskell.org](https://downloads.haskell.org/ghc/latest/docs/libraries/base-4.22.0.0-66f8/Foreign-C-String.html?utm_source=chatgpt.com)

```haskell
foreign import capi "stdio.h printf"
  printInt :: CString -> CInt -> IO CInt
demo = withCString "%d\n" $ \fmt -> printInt fmt 7
```

This deliberately uses `capi`: the current GHC manual says ordinary `ccall` imports do not support variadic functions, whereas a fixed typed `capi` call lets the C compiler handle the variadic ABI. [Glasgow Haskell Compiler 9.14.1 User's Guide](https://downloads.haskell.org/ghc/latest/docs/users_guide/exts/ffi.html?utm_source=chatgpt.com)

## A.11 Julia `ccall`/`@ccall` and Clang.jl

**Version:** inspected Julia **1.13** documentation; Clang.jl `master` package version **0.19.3**.

**[1,2,11]** Julia calls use explicitly declared C argument/result types. Clang.jl generates wrappers from headers with configuration, exclusions and custom prologue/rewriting support. Ordinary Julia mirrors use suitable native-layout fields; exceptional layouts require care. Clang.jl’s generator has special storage/accessor machinery for unions and bitfields, so “Julia has no ordinary union struct representation” should not be mistaken for “Clang.jl cannot bind unions.” [The Julia Language](https://docs.julialang.org/en/v1/manual/calling-c-and-fortran-code/?utm_source=chatgpt.com) Sources: [generator code](https://github.com/JuliaInterop/Clang.jl/blob/master/src/generator/codegen.jl), [configuration](https://juliainterop.github.io/Clang.jl/stable/generator/).

**[3–8,10,13]** `@ccall` roots conversion objects during the call. Raw pointers used outside that scope need `GC.@preserve` and longer retention when C keeps them. `Ref` supplies outputs; array element types and counts must match C. `Cstring` handles NUL-terminated strings, `unsafe_string` copies a result, and release remains separate. Status/errno interpretation is explicit. `unsafe_wrap(...; own=true)` is not a general arbitrary-destructor facility. [The Julia Language](https://docs.julialang.org/en/v1/manual/calling-c-and-fortran-code/?utm_source=chatgpt.com)

```julia
integral = Ref{Cdouble}()
fraction = @ccall modf(2.75::Cdouble, integral::Ref{Cdouble})::Cdouble
```

A concrete generator-side lifetime hazard also exists: Clang.jl documents that accessing libclang objects after their translation unit is collected can segfault. Header parsing itself still has native ownership obligations. [Clang.jl](https://juliainterop.github.io/Clang.jl/stable/api/?utm_source=chatgpt.com)

## A.12 Callback contracts differ substantially

**[7,9,13]** These are mechanisms supplied by the runtime. The C library still determines when registration ends, whether cancellation drains callbacks, whether re-entry is permitted, and which return value means failure.

| System | Lifetime/context mechanism | Exceptions while C frames are active | Foreign-thread behavior and documented hazards |
|---|---|---|---|
| **Bun** | `JSCallback`; explicit `close()` | A reliable general exception contract was **not verified** in the inspected documentation. | `threadsafe` copies arguments and queues JS execution. **C must ignore its return value**, even if the descriptor declares one. [Bun Docs](https://bun.com/docs/runtime/ffi?utm_source=chatgpt.com) |
| **Deno** | `UnsafeCallback`; explicit `close()`; `ref`/`unref` govern event-loop liveness | For callbacks inside a triggering FFI call, the exception propagates after returning through C; C receives zero/NULL. | Foreign-thread dispatch has a separate implementation path that reports unhandled exceptions rather than promising an enclosing synchronous catch. Closing too early permits use-after-free. [Deno Docs](https://docs.deno.com/api/deno/about/?utm_source=chatgpt.com) [Implementation](https://github.com/denoland/deno/blob/main/ext/ffi/callback.rs). |
| **Node-API** | Native state plus JS references; ThreadSafeFunction context/data and acquire/release protocol | Native glue handles pending JS exceptions; Node-API does not provide arbitrary C unwinding. | ThreadSafeFunction queues work onto the JS thread. **BlockingCall waits for queue space, not for the JS result.** A synchronous C result needs another protocol. [ThreadSafeFunction](https://github.com/nodejs/node-addon-api/blob/main/doc/threadsafe_function.md). |
| **Koffi** | Transient callbacks expire with the call; retained callbacks require `register`/`unregister` | Defaults to zero/NULL on callback exception | Foreign-thread calls queue to the JS thread; waiting for that thread while it waits for C can deadlock. There are **8,192 registered slots**; failure to unregister leaks slots. [Koffi](https://koffi.dev/callbacks?utm_source=chatgpt.com) |
| **ffi-napi** | Keep the returned callback Buffer/trampoline alive | A safe, uniform C failure-value contract was **not established** | Its own README warns about poorly defined GC/thread behavior. Keeping only the JS function is not the same as keeping its native trampoline. [Callback wrapper](https://github.com/node-ffi-napi/node-ffi-napi/blob/master/lib/callback.js). [GitHub](https://github.com/node-ffi-napi/node-ffi-napi?utm_source=chatgpt.com) |
| **LuaJIT** | Explicit `ffi.cast` callback can be freed; implicit callbacks remain anchored | Lua errors may unwind through C; documentation warns about skipped cleanup/leaks | JIT-compiled C→Lua re-entry can cause a “bad callback” VM panic. A maintainer permits foreign-thread entry only into an idle, nonconcurrently used VM; independent states/messages are another arrangement. [luajit.org](https://luajit.org/ext_ffi_semantics.html?utm_source=chatgpt.com) [Maintainer qualification](https://github.com/LuaJIT/LuaJIT/issues/542#issuecomment-570171476). |
| **ctypes** | Keep `CFUNCTYPE` objects alive | Exceptions are reported as unraisable; do not assume a useful C failure result | Foreign-thread callbacks create dummy Python thread contexts; `threading.local` state does not persist as users might expect. Collecting the callback can crash a later call. [Python 3.14.10 documentation](https://docs.python.org/3.14/library/ctypes.html?utm_source=chatgpt.com) [Implementation](https://github.com/python/cpython/blob/3.14/Modules/_ctypes/callbacks.c). |
| **cffi** | Prefer `extern "Python"`/`def_extern`; retain `ffi.new_handle` context owners | Configurable `error`/`onerror`; default zero/NULL plus stderr reporting | Supports C-created threads by attaching Python thread state. It acquires the GIL when enabled; free-threaded builds do **not** imply global callback serialization. [CFFI 2.2.0.dev0 documentation](https://cffi.readthedocs.io/en/latest/using.html?utm_source=chatgpt.com) [Tagged thread support](https://github.com/python-cffi/cffi/blob/v2.1.1/src/c/misc_thread_common.h). |
| **OCaml ctypes** | `funptr` follows closure lifetime; `dynamic_funptr` has explicit `free`/`with_fun`; `Root` supports context | Tagged 0.24.0 code invokes callback bodies through `caml_callback`; escaping exceptions can skip C cleanup. Catch inside the callback. | Runtime-lock acquisition and foreign-thread registration are explicit options. Forgotten dynamic function pointers are retained and reported as leaks. [OCaml Package](https://ocaml.org/p/ctypes-foreign/0.24.0/doc/ctypes-foreign/Foreign/index.html?utm_source=chatgpt.com) [Tagged implementation](https://github.com/yallop/ocaml-ctypes/blob/0.24.0/src/ctypes-foreign/ffi_call_stubs.c). |
| **Haskell** | `wrapper` creates a FunPtr; explicit `freeHaskellFunPtr`; `StablePtr` holds opaque context | An uncaught exception escaping a foreign export has undefined behavior under the FFI specification | Re-entry requires the appropriate `safe` call arrangement. `StablePtr` is an opaque identity, **not necessarily dereferenceable C memory**. [haskell.org](https://www.haskell.org/onlinereport/haskell2010/haskellch8.html?utm_source=chatgpt.com) |
| **Julia** | Root the `CFunction` handle for closure-form `@cfunction` | Documentation warns that callback errors can leave execution undefined | The documented foreign-thread integration uses a thin native notification, such as `uv_async_send`, to schedule Julia work. This is not a synchronous callback-result mechanism. [The Julia Language](https://docs.julialang.org/en/v1/manual/calling-c-and-fortran-code/?utm_source=chatgpt.com) |

A returned zero is especially consequential: it is an ordinary valid callback result in some APIs. For example, SQLite’s `exec` callback continues on zero and aborts on nonzero. Thus “catch and return zero” does not by itself translate an exception into an API error. [sqlite.org](https://sqlite.org/c3ref/exec.html?utm_source=chatgpt.com)

## A.13 Constants, macros, inline functions and variadics

**[11,12]** Finding an exported symbol and compiling a C expression are different capabilities.

| System | Constants/macros/inlines | Variadic calls |
|---|---|---|
| Bun | Authored constants; compile an adapter for header-only operations | No general variadic descriptor was present in the inspected public type vocabulary. [Types](https://github.com/oven-sh/bun/blob/main/packages/bun-types/ffi.d.ts). |
| Deno | Authored values or exported C adapters | No ellipsis/fixed-argument-boundary descriptor in the inspected API. [Deno Docs](https://docs.deno.com/api/deno/ffi/?utm_source=chatgpt.com) |
| Node-API | Native glue can use the actual headers, macros and inlines | The C/C++ compiler handles explicitly written call shapes. [Node.js v26.13.0 Documentation](https://nodejs.org/api/n-api.html?utm_source=chatgpt.com) |
| Koffi | Authored enum/constant/type descriptions; wrappers for header-only operations | Typed argument pairs, e.g. `printf("%d", "int", 7)`. This does not validate the format string against the types. [Koffi](https://koffi.dev/load?utm_source=chatgpt.com) |
| ffi-napi | Authored constants and wrapper symbols | `VariadicForeignFunction` creates/caches a callable for each supplied argument-type sequence. [Implementation](https://github.com/node-ffi-napi/node-ffi-napi/blob/master/lib/foreign_function_var.js). |
| LuaJIT | `cdef` enums/static constants; no ordinary preprocessing; inline bodies ignored | Lua numbers default to double in varargs: `%d` needs an explicit integer cdata value, e.g. `ffi.new("int", 7)`. [luajit.org](https://luajit.org/ext_ffi_api.html?utm_source=chatgpt.com) |
| ctypes | Python constants and explicit native wrappers | Set fixed `argtypes`, particularly on Apple ARM64, and use appropriate C scalar wrappers. [Python 3.14.10 documentation](https://docs.python.org/3.14/library/ctypes.html?utm_source=chatgpt.com) |
| cffi | API mode can obtain constants/layouts from C; adapters expose macros/inlines | Declare the function as variadic and pass typed cdata for variable arguments. A fixed declaration is not a portable substitute. [CFFI 2.2.0.dev0 documentation](https://cffi.readthedocs.io/en/latest/cdef.html?utm_source=chatgpt.com) |
| OCaml ctypes | `Cstubs_structs` obtains constants/enums/layouts | Dynamic `Foreign` uses `ffi_prep_cif`, not the variadic preparation API. Portable variadic ABI support was **not established**; fixed-arity generated C stubs are the supported route identified by maintainers. [Tagged source](https://github.com/yallop/ocaml-ctypes/blob/0.24.0/src/ctypes-foreign/ffi_call_stubs.c), [maintainer discussion](https://github.com/yallop/ocaml-ctypes/issues/103#issuecomment-29678387). |
| Haskell | hsc2hs constants/layout; `capi` permits header-based calls | Use fixed typed `capi` shapes; current GHC says `ccall` variadics are unsupported. [GitHub](https://github.com/haskell/hsc2hs?utm_source=chatgpt.com) |
| Julia/Clang.jl | Generator emits enums/constants and selected macros; unsupported macro forms remain gaps | `@ccall` uses a semicolon before typed variable arguments; Clang.jl has opt-in variadic wrapping. Arbitrary `va_list` is a separate problem. [The Julia Language](https://docs.julialang.org/en/v1/manual/calling-c-and-fortran-code/?utm_source=chatgpt.com) |

**[7] `longjmp` remains separate from all these exception mechanisms.** A saved `setjmp` point is valid only while its defining C invocation remains active. Binding `setjmp` as an ordinary function that returns before the protected operation is therefore insufficient. Support for arbitrary jumps across the surveyed managed-runtime frames was not established. [glibc nonlocal-exit rules](https://sourceware.org/glibc/manual/latest/html_node/Non_002dLocal-Details.html). [sourceware.org](https://sourceware.org/glibc/manual/latest/html_node/Non_002dLocal-Details.html?utm_source=chatgpt.com)

# B. Inferring the facts automatically

## B.1 What compiler-derived facts actually mean

**[1,3,4,6,8,10,13]** LLVM’s current language reference—inspected as **24.0.0git**—makes distinctions that a binding extractor must preserve:

| Fact | What it establishes | What it does not establish |
|---|---|---|
| `captures(none)` | This passed pointer copy captures neither address nor provenance | Ownership transfer or a complete lifetime protocol |
| `readonly` | No writes through this argument | Immutability through other aliases |
| `writeonly` | No observable reads through this argument | That anything is written, especially on failure |
| `nofree` | The relevant memory is not freed during the call | Ownership after return |
| `nonnull` | A compiler assumption about the pointer | A protective runtime check |
| `dereferenceable(n)` | Dereferenceability for `n` bytes at the attribute’s applicable point | Element count or validity throughout execution |
| `initializes(...)` | LLVM’s defined byte-range initialization semantics | Useful, successful output values; unwritten bytes may become `undef` |

Missing capture information permits capture. These are optimizer contracts, with undefined-behavior/poison implications when violated, rather than defensive checks. [LLVM Language Reference](https://llvm.org/docs/LangRef.html). [LLVM](https://llvm.org/docs/LangRef.html?utm_source=chatgpt.com)

Two small examples illustrate distinct inference problems:

```c
void maybe_set(int *out, int ok) { if (ok) *out = 1; }
/* Write-only access does not guarantee an initialized output. */
```

```c
static void *saved;
void remember(void *p) { saved = p; }
/* Capture alone does not identify who must eventually release p. */
```

**Assessment:** source analysis can prove useful properties within a supported model and build configuration. It cannot silently turn an access effect into a stronger semantic postcondition. Inferring a precondition required for defined execution also does not prove that the implementation checks that precondition.

## B.2 Production analysis engines

The following figures measure different outcomes. Bug-finding classifications, pointer-conversion rates and contract-extraction precision should not be compared as though they measured the same thing.

| System | What it infers; soundness boundary | Reported real-program evidence and cost |
|---|---|---|
| **LLVM Attributor** — **[1,3,4,6,8,10,13]** | Interprocedural abstract attributes: capture, memory effects, non-nullness, dereferenceability, non-freeing, etc. Deductions depend on valid LLVM IR and analysis assumptions. When iteration limits are reached, dependent unsettled deductions are forced pessimistic. | No complete C-library binding-contract precision/recall or standard wall-time benchmark was verified in current documentation. Cost depends on analyses, module size and iteration limits. It is a framework for compiler deductions, not an allocation-family or callback-protocol extractor. [Official source documentation](https://llvm.org/doxygen/Attributor_8h_source.html). [llvm.org](https://llvm.org/doxygen/Attributor_8h_source.html?utm_source=chatgpt.com) |
| **Clang Static Analyzer** — **[1,4,6,7,8,10,13]** | Path-sensitive interprocedural symbolic execution finds null, allocation, stream and other defects. It is deliberately incomplete: bounded exploration, inlining heuristics and suppressed paths mean no warning is not proof of a contract. | No complete-contract extraction evaluation was verified. Its options documentation reports about **10% average runtime increase** for one more aggressive ambiguous-loop inlining option; that is a configuration comparison, not total analyzer cost. [Overview](https://clang.llvm.org/docs/ClangStaticAnalyzer.html), [options](https://clang.llvm.org/docs/analyzer/user-docs/Options.html). [Clang](https://clang.llvm.org/docs/ClangStaticAnalyzer.html?utm_source=chatgpt.com) |
| **Infer / Pulse** — **[1,3,4,6,8,10,13]** | Bi-abduction infers heap preconditions/postconditions and composes reusable procedure summaries. Pulse tracks latent requirements and faulty executions. Current **Infer 1.3.0** docs explicitly describe optimistic treatment of unavailable functions/function pointers, with both false negatives and false positives. | The **Pulse-X OOPSLA 2022** evaluation reported **30 OpenSSL 3.0.0 issues: 15 true, five uncertain, ten likely false**; maintainers confirmed/fixed the 15 true issues. Ten-project batch analysis cost **4–900 CPU minutes**. This is evidence about bug finding, not exported-contract accuracy. [Pulse](https://fbinfer.com/docs/checker-pulse/), [paper](https://jberdine.github.io/pub/2022_oopsla.pdf). [Infer](https://fbinfer.com/docs/checker-pulse/?utm_source=chatgpt.com) |

## B.3 Ownership and safe-code conversion

| System | Inferred facts and soundness | Authors’ measurements and practical cost |
|---|---|---|
| **c2rust ownership analysis / c2rust-analyze** — **[1,2,3,6,8,13]** | The ownership analysis infers READ/WRITE/MOVE permissions for fields/signatures, including permission polymorphism and manual annotations. Current `c2rust-analyze` is explicitly a prototype covering a small subset and retaining `unsafe`. A full soundness guarantee was **not verified**. | No current precision/coverage evaluation for these exact implementations was verified. Very large functions may take **several minutes** in Polonius. The README warns that independently rewritten definitions and `extern "C"` declarations can disagree and cause **segfaults/UB**, requiring amalgamation or reconciliation. [Ownership README](https://github.com/immunant/c2rust/blob/master/c2rust-refactor/src/analysis/ownership/README.md), [current analyzer README](https://github.com/immunant/c2rust/blob/master/c2rust-analyze/README.md). |
| **Laertes, OOPSLA 2021** — **[1,2,3,8,13]** | Uses pointer-use analysis and Rust compiler feedback to convert portions of c2rust output to references/lifetimes/owned pointers. Rust checks converted code; this does not establish end-to-end correctness of original C behavior and foreign dependencies. | **1,263/1,448 eligible lifetime-only pointer declarations = 87%**, but **1,263/15,185 total declarations = 8.3%**. Twelve programs; reported runtimes **1–1,712 seconds**, with libxml2 taking about 29 minutes on an i7-4790/32 GB machine. [Extended paper, Tables 4–5 and 9–10](https://hardekbc.github.io/files/oopsla21-extended.pdf). [Extended Version](https://hardekbc.github.io/files/oopsla21-extended.pdf?utm_source=chatgpt.com) |
| **Crown, CAV 2023** — **[1,2,3,6,8,13]** | Field- and flow-sensitive ownership constraints, with separate mutability/array analysis. **The implementation is explicitly described as neither sound nor complete**: unsupported constructs generate partial constraints. Function pointers/custom allocation schemes are major gaps. | Across **20 selected programs**, median reductions were **37.3% of declarations / 62.1% of uses**, within the **mutable, non-array pointer** scope. The suite took under a minute; **537,723-LOC Brotli under ten seconds**, on an M1/16 GB system. All outputs compiled; six supplied test suites passed. Unions/varargs excluded some benchmarks. [Paper §§7–8](https://mengwangoxf.github.io/Papers/CAV23.pdf). [mengwangoxf.github.io](https://mengwangoxf.github.io/Papers/CAV23.pdf?utm_source=chatgpt.com) |
| **CCured, TOPLAS 2005** — **[1,2,3,4,8,12,13]** | Infers SAFE/sequence/WILD-style pointer classes, changes representation, inserts checks and uses memory-management transformations including GC. Its safety is for transformed code with trusted boundaries; trusted casts explicitly weaken soundness. | For **OpenSSL 0.9.6e, 177,426 LOC**: **67% SAFE, 27% sequence, 6% RTTI**, about **2,000 changed lines**, two trusted casts; **1.40× runtime, 1.81× memory** versus its C baseline, which excluded faster assembly. Bind required **237 trusted casts**. Isolated inference wall time was **not verified**. [Paper, Figure 18](https://people.eecs.berkeley.edu/~necula/Papers/ccured_toplas.pdf). [people.eecs.berkeley.edu](https://people.eecs.berkeley.edu/~necula/Papers/ccured_toplas.pdf?utm_source=chatgpt.com) |
| **Checked C / 3C, OOPSLA 2022** — **[1,2,4,5,6,10,13]** | Infers pointer kinds and bounds for **spatial** safety. Nonheuristic bounds inference aims to return correct bounds or leave them missing; additional name/usage heuristics are not proofs. Temporal safety is not supplied generally. Checked regions receive compiler/runtime enforcement; legacy contracts remain assumptions. | Detailed tables: **319.6 KSLOC, 26,413 pointer levels; 17,924 checked = 67.9%**. Bounds: **792/1,024 array pointers = 77.3%**; **428/727 NUL-terminated pointers = 58.9%**. **15/792** array bounds came from heuristics, only sampled manually. Median timings: **0.46–43.74 seconds**, **84.49 seconds total**. Complex bounds such as `n*m` were a limitation. [Tables 2–5](https://purs3lab.github.io/files/3c.pdf). [purs3lab.github.io](https://purs3lab.github.io/files/3c.pdf?utm_source=chatgpt.com) |

Two qualifications prevent misleading conclusions:

- Laertes’s **2023 follow-up** reports **12%→21%** in deliberately “pseudo-safe” experiments that can change semantics. That measures potential and alias-analysis limitations, not a deployable semantics-preserving conversion rate. [Aliasing Limits](https://www.cs.usfca.edu/~memre/oopsla23-aliasing-limits.pdf). [cs.usfca.edu](https://www.cs.usfca.edu/~memre/oopsla23-aliasing-limits.pdf?utm_source=chatgpt.com)
- 3C’s introduction contains older totals/timings inconsistent with its detailed evaluation tables. The figures above use the tables, rather than mixing the introduction’s roughly 371 KLOC/22-second figures with later results. [purs3lab.github.io](https://purs3lab.github.io/files/3c.pdf?utm_source=chatgpt.com)

## B.4 Work aimed directly at bindings, and a 2026 result

### Automatic binding idioms: Ravitch and colleagues

**[1,3,4,6,8,13]** The **PLDI 2009** work directly generated Python bindings from implementation analyses of arrays, constructors/finalizers, output/in-out parameters and pointer escape. Dependencies required source or annotations, including manually seeded standard-library facts.

At least one idiom was detected in:

| Library | Functions annotated / public functions |
|---|---:|
| GLPK | 87 / 239 |
| libarchive | 80 / 193 |
| libical | 461 / 917 |
| GSL | 1,416 / 3,863 |

These are detected-pattern counts, not complete-safe-binding coverage or recall. GLPK analysis took **17 minutes**; the other libraries took **five minutes or less**, on a 3 GHz Pentium 4/1 GB system. [PLDI paper](https://pages.cs.wisc.edu/~liblit/pldi-2009-b/pldi-2009-b.pdf). [pages.cs.wisc.edu](https://pages.cs.wisc.edu/~liblit/pldi-2009-b/pldi-2009-b.pdf?utm_source=chatgpt.com)

The **ISMM 2013** continuation explicitly separates escape from ownership transfer and infers finalizers, transfers and reference-counting patterns. It calls the analysis **unsound and incomplete**, followed by expert review. Across nine reference-counted libraries, all reported increment/decrement pairings were judged correct except **one of Fontconfig’s three pairs**, where initialization was mistaken for incrementing. Custom schemes and finalizers were missed; some annotations remained manual. No elapsed analysis time was located in the inspected paper. [ISMM paper](https://pages.cs.wisc.edu/~liblit/ismm-2013/ismm-2013.pdf). [pages.cs.wisc.edu](https://pages.cs.wisc.edu/~liblit/ismm-2013/ismm-2013.pdf?utm_source=chatgpt.com)

### `&inator`, PLDI 2026

**[1,2,3,4,8,10,13]** Published **8 June 2026**, `&inator` derives Rust interface types using LLVM and SMT constraints. Its correctness claim concerns an interface that admits a safe semantics-preserving implementation within its model, with stated borrowing/leak qualifications. It is not a safe wrapper around an unchanged C binary.

Only **six cases, 41–346 C LOC**, had interfaces manually validated by constructing safe implementations. Larger cases measured scalability only and were modified to remove unsupported constructs. Unsupported areas include function/polymorphic pointers, standalone libraries and multithreading; libc constraints were manual.

Reported solving times include **1,100 seconds for 346 LOC**, **17,000 seconds for 1,394 LOC**, and **25,000 seconds for 3,656 LOC**, averaged over five runs on Xeon Platinum 8268 hardware. This is a current, promising result with substantial scope and cost limits. [Paper](https://doi.org/10.1145/3808270). [doi.org](https://doi.org/10.1145/3808270?utm_source=chatgpt.com)

## B.5 Mining documentation and using LLMs

### Original Doc2Spec, ASE 2009

**[1,7,8,13]** Doc2Spec mines action/resource descriptions and resource-protocol automata from natural-language API documentation. It is heuristic specification mining, not proof that documentation matches code.

Its evaluation used **five Java documentation collections**, not C libraries. Against **147 reference specifications from 34 sampled class hierarchies**, transition precision ranged **70.7–86.5%**, recall **74.0–86.2%**. Training required **687 manually annotated method descriptions**, approximately **one human-day**, and ten seconds of model training. Processing **49,524 methods** produced **3,981 specifications**; extraction/inference phases totaled approximately **3,790 seconds** on the study’s hardware. These results concern protocol transitions, not C encodings, count units or callback threads. [Paper](https://taoxiease.github.io/publications/ase09-doc2spec.pdf). [taoxiease.github.io](https://taoxiease.github.io/publications/ase09-doc2spec.pdf?utm_source=chatgpt.com)

### LLM-based Doc2Spec, 2026

**[1,4,6,7,8,10,13]** A separate 2026 project uses LLM extraction, grammar induction and grammar-constrained formalization. Grammar/schema compliance establishes syntax, not semantic correctness.

The verified **v1 manuscript, dated 30 January 2026**, evaluates **seven documents and 304 reference rules**: Solidity, Rust allocator and Java API documents. Average precision/recall are **0.71/0.74**. The two allocator cases score **0.63/0.86** and **0.46/0.56**—particularly relevant evidence against silently trusting extracted ownership predicates.

Its experiments used **18.4 million tokens total**, including retries and multiple runs; that is not a per-library cost. Dollar cost and elapsed runtime were **not verified**. No C-library benchmark or complete treatment of temporal callback protocols was established. Later revision figures were not mixed with these v1 results. [Manuscript](https://arxiv.org/html/2602.04892v1). [arxiv.org](https://arxiv.org/html/2602.04892v1?utm_source=chatgpt.com)

**Finding:** documentation extraction can locate useful evidence and propose contracts. Neither an LLM’s confidence nor a well-formed output schema converts those proposals into proved facts.

# C. A catalogue of real C API patterns

## C.1 Scope, versions and counting method

The counts below cover **243 public API entries**.

- **zlib:** a census of **78 logical APIs** in the main documented section of [`zlib.h` at `v1.3.2`](https://github.com/madler/zlib/blob/v1.3.2/zlib.h), from `zlibVersion` through `crc32_combine_op`. Init macros count once; conditional duplicate declarations are deduplicated. Internal suffixed entry points, large-file aliases, the undocumented tail and contrib are excluded.
- **curl:** a systematic sample of **25 from 100 entries** in the official All Functions index: positions 1, 5, 9, …, 97. Deprecated and `va_list` entries remain in the sampling frame. [Index](https://curl.se/libcurl/c/allfuncs.html). [All Functions List](https://curl.se/libcurl/c/allfuncs.html?utm_source=chatgpt.com)
- **Seven larger libraries:** a **purposive 20-function probe each**, covering allocation, I/O, lookup, callbacks and cleanup. These give incidence in the enumerated samples, **not unbiased whole-library prevalence estimates**. A current complete semantic census of those libraries was not established.

Reference versions:

| Library | Reference |
|---|---|
| POSIX/glibc | glibc **2.44** manual plus Linux man-pages for the sampled POSIX/Linux interfaces |
| zlib | **1.3.2**, 17 February 2026, pinned header |
| SQLite | Current API docs; **3.54.1**, 16 October 2026 |
| libuv | 1.x docs; **1.53.0**, 24 September 2026 |
| OpenSSL | **3.5** documentation; 3.5.9 appears in the 29 September 2026 release timeline |
| curl | Rolling docs; **8.23.0**, 14 October 2026 |
| libpng | **1.6.59**, 30 September 2026, pinned header/manual |
| GLib/GObject | Rolling generated **2.91.0 development documentation** |
| SDL | SDL3 wiki; stable **3.4.18** release reference |

Version evidence: [glibc](https://www.sourceware.org/glibc/manual/), [SQLite](https://www.sqlite.org/), [libuv](https://github.com/libuv/libuv/releases), [OpenSSL](https://www.openssl-library.org/news/timeline/index.html), [curl](https://curl.se/changes.html), [libpng](https://www.libpng.org/pub/png/pngnews.html), [GLib](https://docs.gtk.org/glib/func.file_get_contents.html), [SDL](https://github.com/libsdl-org/SDL/releases.html). [sqlite.org](https://www.sqlite.org/?utm_source=chatgpt.com)

## C.2 Frequencies in the inspected surfaces

### Data, strings, state and varargs — [2,4,5,6,8,12]

“Out/in-out” counts explicit result slots and buffers, excluding mutation of the primary state object. “Byte/element pairs” counts **direct** relationships; lengths hidden in structs, other calls or options are excluded. “Borrowed string” includes aliases of caller storage. Nested strings inside returned vectors/records are excluded. Counts overlap; zero does not mean the library lacks the pattern.

| Surface | N | Out / in-out | Byte / element pairs | NUL input | Owned / borrowed strings | Caller state | `...` |
|---|---:|---:|---:|---:|---:|---:|---:|
| POSIX/glibc probe | 20 | 8 / 4 | 6 / 2 | 5 | 4 / 3 | 2 | 2 |
| **zlib census** | **78** | **17 / 8** | **19 / 2** | **4** | **0 / 3** | **32** | **1** |
| SQLite probe | 20 | 5 / 0 | 4 / 0 | 7 | 2 / 3 | 0 | 1 |
| libuv probe | 20 | 3 / 0 | 1 / 2 | 2 | 0 / 1 | 15 | 1 |
| OpenSSL probe | 20 | 4 / 0 | 4 / 0 | 2 | 0 / 1 | 0 | 1 |
| curl systematic sample | 25 | 8 / 0 | 3 / 0 | 10 | 1 / 0 | 0 | 1 |
| libpng probe | 20 | 6 / 2 | 3 / 1 | 2 | 0 / 1 | 5 | 0 |
| GLib/GObject probe | 20 | 3 / 0 | 5 / 0 | 9 | 4 / 1 | 2 | 1 |
| SDL3 probe | 20 | 4 / 0 | 1 / 1 | 5 | 1 / 3 | 0 | 1 |

For zlib’s stated surface, that is approximately **22% explicit-output APIs, 24% direct byte/count APIs, and 41% caller-state APIs**. These are overlapping categories.

### Native resources and errors — [7,8]

“Object APIs” accept/return opaque or accessor-managed native objects. This is semantic: `gzFile` and GObject expose some ABI structure. Scalar IDs are separate. “Release” includes cleanup, unref and join, but excludes incidental release during replacement and mere stop/reset operations.

Error columns count status/flag returns, otherwise-useful numeric results with failure sentinels, and NULL that can indicate failure. They overlap.

| Surface | Object APIs / ID APIs | Explicit release | Status/flag | Numeric sentinel | NULL failure | Additional channels observed |
|---|---:|---:|---:|---:|---:|---|
| POSIX/glibc | 3 / 9 | 4 | 4 | 10 | 4 | 14 errno-associated failures |
| zlib | 26 / 1 | 6 | 43 | 15 | 3 | `gzerror` out-code; ≥8 errno paths |
| SQLite | 18 / 0 | 4 | 14 | 1 | 3 | Owned error-string output; borrowed message accessor |
| libuv | 0 / 4 | 5 | 15 | 0 | 0 | 8 deferred-outcome APIs |
| OpenSSL | 18 / 0 | 3 | 6 | 1 | 3 | Per-thread error queue and `SSL_get_error` |
| curl | 17 / 1 | 4 | 14 | 2* | 3 | Multi completion-message retrieval |
| libpng | 15 / 0 | 2 | 4 | 0 | 2 | 4 simplified state-error APIs; ≥5 identified fatal/jump paths |
| GLib/GObject | 10 / 2 | 4 | 2 | 0 | 1 | 3 `GError **`; explicit thread-creation abort |
| SDL3 | 7 / 2 | 5 | 5 | 1 | 4 | Empty-string failure; status output; thread-local error text |

Important boundaries:

- libuv’s zero “Object APIs” reflects its **caller-allocated handle structures**, counted in the preceding table; it does not mean libuv has no handles. [libuv documentation](https://docs.libuv.org/en/latest/handle.html?utm_source=chatgpt.com)
- `*` curl’s two numeric cases are implementation observations: sampled `curl_msnprintf`/`curl_mvsprintf` can produce zero after format parsing fails, also a valid empty-output count. This is not a documented, distinct POSIX-style error result. [Pinned implementation](https://github.com/curl/curl/blob/curl-8_23_0/lib/mprintf.c).
- The libpng jump count is a lower bound over identified internal paths, not a transitive whole-library proof. The simplified API catches internal errors and returns status. [Manual](https://libpng.org/pub/png/libpng-manual.txt), [pinned validation path](https://github.com/pnggroup/libpng/blob/v1.6.59/pngget.c). [libpng.org](https://libpng.org/pub/png/libpng-manual.txt?utm_source=chatgpt.com)
- The GLib abort count is one explicitly documented sampled operation, not a count of all transitive allocation-failure aborts. [docs.gtk.org](https://docs.gtk.org/glib/ctor.Thread.new.html?utm_source=chatgpt.com)

### Callbacks — [9]

These count functions with **direct callback parameters**, including destructors and removal functions. Callbacks stored in fields or selected through varargs are excluded.

“Explicit context” includes registration data later recovered through an accessor. “Object context” means a callback receives a handle/request with a `.data` field. “No context” means no independent application-data channel in that registration signature.

| Surface | Direct callback APIs | Explicit / object / no context | Call-bounded / retained | Execution classes |
|---|---:|---:|---:|---|
| POSIX/glibc | 2 | 1 / 0 / 1 | 1 / 1 | Operation thread 1; new thread 1 |
| zlib | 1 | 1 / 0 / 0 | 1 / 0 | Operation thread 1 |
| SQLite | 5 | 3 / 0 / 2 | 1 / 4 | Operation thread 5 |
| libuv | 10 | 1 / 9 / 0 | 0 / 10 | Loop thread 9; worker/new thread 2 |
| OpenSSL | 2 | 1 / 0 / 1 | 0 / 2 | Operation thread 2 |
| curl | 2 | 2 / 0 / 0 | 2 / 0 | Operation thread 2 |
| libpng | 4 | 4 / 0 / 0 | 0 / 4 | Operation thread 4 |
| GLib/GObject | 4 | 3 / 0 / 1 | 0 / 4 | Operation/emission 2; main context 1; new thread 1 |
| SDL3 | 4 | 4 / 0 / 0 | 0 / 3; removal 1 | Worker/new thread 2; event watch may use another thread; removal 1 |

libuv’s thread counts overlap because `uv_queue_work` has worker and loop callbacks. A retained “operation-thread” callback is not guaranteed to use its **registration** thread. Sources and representative contracts follow. [libuv documentation](https://docs.libuv.org/en/v1.x/threadpool.html?utm_source=chatgpt.com)

## C.3 Representative contracts and their consequences

### POSIX/glibc — [2–10,12]

`read` uses byte capacity; `readv` counts `iovec` elements, each carrying its own byte length. `getsockopt` makes the count in-out: capacity on entry, actual size on return. `qsort` has element count plus element size and no independent comparator context; GNU `qsort_r` adds context. [Linux manual page](https://man7.org/linux/man-pages/man2/getsockopt.2.html?utm_source=chatgpt.com)

```c
char *line = NULL; size_t capacity = 0;
ssize_t n = getline(&line, &capacity, stream);
free(line);  /* allocation can remain even after failure */
```

`getline` can realloc and invalidate aliases; its count supports embedded NULs. GNU allocating forms of `getcwd` and `realpath` demonstrate **argument-dependent ownership**: supplied storage produces an alias; NULL storage can request an allocation freed with `free`. [sourceware.org](https://sourceware.org/glibc/manual/latest/html_node/Line-Input.html?utm_source=chatgpt.com)

Resources include `FILE*→fclose`, descriptor→`close`, and caller-owned `pthread_mutex_t`→init/destroy. `pthread_create` passes context to a new-thread callback and returns an error number directly. Successful calls may change errno, so errno alone is not a failure predicate. [Linux manual page](https://man7.org/linux/man-pages/man3/pthread_create.3.html?utm_source=chatgpt.com)

### zlib — [2–9,11,12]

```c
uLongf written = capacity;
int rc = compress(dst, &written, src, source_bytes);
/* capacity enters through written; produced byte count comes back */
```

`z_stream` hides the largest buffer relationships inside state: `next_in/avail_in` and `next_out/avail_out` advance together. Allocator callbacks and `opaque` context also live in that state. A shallow struct copy is not the documented duplication operation: `deflateCopy` duplicates internal compression state, with separate cleanup obligations. [Pinned header](https://github.com/madler/zlib/blob/v1.3.2/zlib.h).

`inflateBack` has distinct input/output callback contexts. `gzerror` returns borrowed text; `gzgets` returns an alias of caller storage. Streams use init/end, while `gzFile` uses `gzclose`. `Z_BUF_ERROR` can indicate no progress, and `Z_ERRNO` requires consulting errno.

The public init names are macros supplying **version and struct size** to internal functions. `gzprintf` is variadic; `gzfread`/`gzfwrite` use element size and count. [Header](https://github.com/madler/zlib/blob/v1.3.2/zlib.h). The HTML [manual](https://www.zlib.net/manual.html) still identifies itself as 1.3.1; it was not used as the 1.3.2 census denominator.

### SQLite — [3–10,12]

```c
sqlite3_bind_text(stmt, 1, text, byte_count, SQLITE_TRANSIENT);
if (sqlite3_step(stmt) == SQLITE_ROW)
    consume(sqlite3_column_text(stmt, 0));
sqlite3_finalize(stmt);
```

`bind_text` combines three lifetime modes: destructor callback, retained caller storage via `SQLITE_STATIC`, or immediate copy via `SQLITE_TRANSIENT`. Lengths are bytes; negative text lengths select NUL termination, while negative blob lengths are undefined. A destructor may run **even when binding fails**. [sqlite.org](https://sqlite.org/c3ref/bind_blob.html?utm_source=chatgpt.com)

Column text is borrowed and can be invalidated by conversion, `step`, `reset` or `finalize`. NULL can mean SQL NULL or conversion OOM. `sqlite3_exec`’s error string instead needs `sqlite3_free`. [sqlite.org](https://sqlite.org/c3ref/column_blob.html?utm_source=chatgpt.com)

Release has multiple state transitions:

- `sqlite3_close`: `SQLITE_BUSY` leaves the connection alive.
- `close_v2`: makes it unusable and defers destruction until dependencies disappear; explicitly intended for GC hosts with arbitrary finalizer order.
- `sqlite3_finalize`: destroys the statement even when returning a prior execution error.
- `sqlite3_open`: can fail while still returning a connection requiring cleanup. [sqlite.org](https://www.sqlite.org/c3ref/close.html?utm_source=chatgpt.com)

Registered SQL functions outlive registration; `exec` callbacks do not. The busy callback must not modify its invoking connection, an explicit re-entrancy restriction. [sqlite.org](https://sqlite.org/c3ref/create_function.html?utm_source=chatgpt.com)

### libuv — [2–9,12]

```c
int rc = uv_write(&request, stream, buffers, nbufs, completed);
/* accepted request and backing bytes survive until completed */
```

Handles are **immovable caller storage**. Their storage survives until the asynchronous `uv_close` callback. Writes combine a count of `uv_buf_t` elements with byte lengths inside each element; backing bytes and request storage survive completion. [libuv documentation](https://docs.libuv.org/en/latest/handle.html?utm_source=chatgpt.com)

Context usually lives in `handle.data` or `request.data`. `uv_queue_work` runs work on a pool thread and completion on the loop thread. A submission error suppresses the callback, so successful submission and eventual completion are distinct contract stages. [libuv documentation](https://docs.libuv.org/en/v1.x/threadpool.html?utm_source=chatgpt.com)

`uv_ref`/`uv_unref` are **idempotent loop-liveness toggles**, not ownership reference counting. `uv_loop_close` can report busy state; `uv_run` reports liveness and is not reentrant; `uv_loop_configure` is option-dependent varargs. Even `uv_read_stop` defeats generic “nonzero means error”: current documentation describes nonzero pending Windows TTY cleanup despite successful stopping. [libuv documentation](https://docs.libuv.org/en/latest/handle.html?utm_source=chatgpt.com)

### OpenSSL — [3–10,12]

```c
size_t received;
int ok = SSL_read_ex(ssl, buffer, capacity, &received);
if (!ok) { int why = SSL_get_error(ssl, ok); /* interpret retry/failure */ }
```

`SSL_get_error` depends on the same thread’s error queue and must follow the relevant operation without intervening OpenSSL calls; the queue must have been clear beforehand. WANT_READ/WANT_WRITE are protocol states, not ordinary fatal failures. [OpenSSL Documentation](https://docs.openssl.org/3.5/man3/SSL_read/?utm_source=chatgpt.com)

There is real shared ownership through `SSL_up_ref`/`SSL_free` and `X509_up_ref`/`X509_free`. `SSL_set0_rbio` consumes a BIO reference and releases the previous BIO; aliasing the same BIO across read/write setters changes the required reference accounting. `BIO_free` itself documents a success/failure return. [OpenSSL Documentation](https://docs.openssl.org/3.5/man3/SSL_new/?utm_source=chatgpt.com)

ALPN selection has explicit context and can return a slice aliasing input. Verification has no independent context parameter but supports recovery through OpenSSL context/ex-data. `SSL_get0_peername` is borrowed and invalidated by operations beyond destruction, including clear/renegotiation. [OpenSSL Documentation](https://docs.openssl.org/3.5/man3/SSL_CTX_set_alpn_select_cb/?utm_source=chatgpt.com)

### curl — [3–10,12]

```c
curl_easy_setopt(easy, CURLOPT_POSTFIELDSIZE, (long)n);
curl_easy_setopt(easy, CURLOPT_POSTFIELDS, body);
curl_easy_perform(easy);  /* body survives the transfer */
```

`curl_easy_setopt` is a family of contracts selected by the option. Most string options copy; `POSTFIELDS` borrows, while `COPYPOSTFIELDS` copies. Data and byte count arrive in **different calls**. `getinfo` likewise selects the output pointer type through an option. [curl_easy_setopt()](https://curl.se/libcurl/c/curl_easy_setopt.html?utm_source=chatgpt.com)

`curl_url_get` produces text for `curl_free`; `CURLINFO_EFFECTIVE_URL` produces borrowed text potentially invalidated by the **next call on the handle**. Write callbacks receive non-NUL-terminated byte spans, with context set separately through `WRITEDATA`. [curl_url_get()](https://curl.se/libcurl/c/curl_url_get.html?utm_source=chatgpt.com)

Cleanup is not a callback-free phase: `curl_easy_cleanup` can invoke progress/header callbacks during shutdown. A multi-associated easy handle must first be removed from its multi handle. [curl_easy_cleanup()](https://curl.se/libcurl/c/curl_easy_cleanup.html?utm_source=chatgpt.com)

### libpng — [2–11]

```c
if (setjmp(png_jmpbuf(png))) {
    png_destroy_read_struct(&png, &info, NULL); return -1;
}
png_read_image(png, rows);
```

Low-level errors normally `longjmp`; error callbacks must not return. Recovery needs cleanup while the saved C frame remains active. The simplified API instead uses caller-owned `png_image` state and status/message fields; incorrect initialization is documented as potentially crashing. [libpng.org](https://libpng.org/pub/png/libpng-manual.txt?utm_source=chatgpt.com)

Buffer sizes depend on dimensions and transformations. `png_image_finish_read` stride is in **bytes or two-byte units according to format**, and may be negative. `png_get_text` returns records containing borrowed strings with field-specific nullability. [Pinned header](https://github.com/pnggroup/libpng/blob/v1.6.59/png.h).

I/O/error/progressive callbacks retain context recovered from `png_struct`. `png_destroy_read_struct` takes in-out pointer slots; `png_image_free` tears down caller-owned state. The September 2026 release fixed a concrete retained-pointer use-after-free involving a zlib stream and malformed ancillary data. [libpng.org](https://libpng.org/pub/png/libpng-manual.txt?utm_source=chatgpt.com)

### GLib/GObject — [1–10,12]

```c
gchar *contents = NULL; gsize n; GError *error = NULL;
gboolean ok = g_file_get_contents(path, &contents, &n, &error);
/* contents → g_free; error, if set → g_error_free */
```

Generated docs carry ownership, nullable output slots, byte counts and `GError **` initialization requirements. `g_convert` reports bytes read/written; filename encodings are platform-dependent. `g_getenv` returns borrowed platform-native text invalidated by environment operations. [docs.gtk.org](https://docs.gtk.org/glib/func.file_get_contents.html?utm_source=chatgpt.com)

`g_strsplit` returns a NULL-terminated vector of owned strings for `g_strfreev`, beyond the direct-string count. `g_bytes_get_data` permits either NULL or non-NULL for an empty byte array. [docs.gtk.org](https://docs.gtk.org/glib/func.strsplit.html?utm_source=chatgpt.com)

Signals/timeouts can have destroy notifications. Timeout callbacks run in the thread executing the relevant main context. `g_thread_new` aborts on creation failure. GHashTable destruction callbacks may recursively remove entries only under a documented retained-reference condition. [docs.gtk.org](https://docs.gtk.org/gobject/func.signal_connect_data.html?utm_source=chatgpt.com)

### SDL3 — [3–12]

```c
char *text = SDL_GetClipboardText();
consume(text);
SDL_free(text);
```

Clipboard text is allocated UTF-8; the inspected documentation specifies an **empty string on failure**. `SDL_GetBasePath` is a cached borrowed string. `SDL_GetError` is thread-local borrowed text, invalidated when changed; successful operations need not clear it. [SDL Wiki](https://wiki.libsdl.org/SDL3/SDL_GetClipboardText?utm_source=chatgpt.com)

Timer callbacks run on a separate thread and can run **before `SDL_AddTimer` returns**; their return chooses the next interval. Event watches may also run on another thread. `SDL_GetKeyboardState` has stable storage lifetime but contents that can change without synchronization: lifetime is not snapshot consistency. [SDL Wiki](https://wiki.libsdl.org/SDL3/SDL_AddEventWatch?utm_source=chatgpt.com)

`SDL_CreateThread` is a macro supplying **two hidden C-runtime arguments**; its documentation explicitly warns bindings that bypass headers. A thread object also requires wait/detach cleanup—omitting it leaks the object. [SDL Wiki](https://wiki.libsdl.org/SDL3/SDL_CreateThread?utm_source=chatgpt.com)

## C.4 Exact sample inventories

These are the denominators for the probe tables. Prefix abbreviations are stated explicitly.

- **POSIX/glibc:** `read`, `write`, `readv`, `recvfrom`, `getsockopt`, `getline`, `strdup`, `strerror`, `fopen`, `fclose`, `open`, `close`, `pthread_mutex_init`, `pthread_mutex_destroy`, `pthread_create`, `pthread_join`, `qsort`, `printf`, `getcwd`, `realpath`.
- **SQLite**, each prefixed `sqlite3_`: `open`, `close`, `close_v2`, `prepare_v2`, `step`, `finalize`, `reset`, `bind_text`, `bind_blob`, `column_text`, `column_blob`, `column_bytes`, `errmsg`, `exec`, `mprintf`, `free`, `blob_open`, `blob_read`, `busy_handler`, `create_function_v2`.
- **libuv**, each prefixed `uv_`: `loop_init`, `loop_close`, `tcp_init`, `tcp_connect`, `listen`, `read_start`, `read_stop`, `write`, `close`, `fs_open`, `fs_read`, `fs_req_cleanup`, `getaddrinfo`, `freeaddrinfo`, `queue_work`, `thread_create`, `thread_join`, `ip4_name`, `strerror`, `loop_configure`.
- **OpenSSL:** `SSL_CTX_new`, `SSL_CTX_free`, `SSL_new`, `SSL_free`, `SSL_read_ex`, `SSL_write_ex`, `SSL_get_error`, `SSL_get0_peername`, `SSL_get1_peer_certificate`, `SSL_set1_host`, `SSL_set0_rbio`, `X509_up_ref`, `SSL_CTX_set_verify`, `SSL_CTX_set_alpn_select_cb`, `BIO_new`, `BIO_free`, `BIO_printf`, `EVP_Digest`, `ERR_get_error`, `ERR_error_string_n`.
- **curl**, each prefixed `curl_`: `easy_cleanup`, `easy_header`, `easy_option_by_name`, `easy_recv`, `easy_ssls_export`, `easy_upkeep`, `formget`, `global_cleanup`, `global_trace`, `mime_data`, `mime_filename`, `mime_name`, `msnprintf`, `multi_cleanup`, `multi_info_read`, `multi_perform`, `multi_socket`, `multi_timeout`, `mvaprintf`, `mvsprintf`, `share_init`, `slist_free_all`, `url`, `url_set`, `ws_meta`.
- **libpng**, each prefixed `png_`: `create_read_struct`, `create_info_struct`, `destroy_read_struct`, `init_io`, `set_read_fn`, `set_error_fn`, `read_info`, `get_IHDR`, `get_rowbytes`, `read_row`, `read_image`, `get_text`, `get_libpng_ver`, `image_begin_read_from_file`, `image_begin_read_from_memory`, `image_finish_read`, `image_write_to_memory`, `image_free`, `set_progressive_read_fn`, `process_data`.
- **GLib/GObject**, each prefixed `g_`: `strdup`, `strsplit`, `getenv`, `file_get_contents`, `file_set_contents`, `convert`, `hash_table_new_full`, `hash_table_insert`, `hash_table_unref`, `bytes_new`, `bytes_get_data`, `bytes_unref`, `object_ref`, `object_unref`, `signal_connect_data`, `timeout_add_full`, `thread_new`, `mutex_init`, `mutex_clear`, `strdup_printf`.
- **SDL3**, each prefixed `SDL_`: `Init`, `Quit`, `CreateWindow`, `DestroyWindow`, `GetWindowSize`, `GetWindowTitle`, `SetWindowTitle`, `GetClipboardText`, `free`, `LoadFile`, `GetBasePath`, `GetError`, `SetError`, `AddEventWatch`, `RemoveEventWatch`, `AddTimer`, `RemoveTimer`, `CreateThread`, `WaitThread`, `GetKeyboardState`.

For independent zlib recomputation, its 17 output APIs are `deflateGetDictionary`, `deflatePending`, `deflateUsed`, `inflateGetDictionary`, `inflateGetHeader`, the eight `compress`/`uncompress` variants, `gzread`, `gzfread`, `gzgets`, and `gzerror`. The eight compression/decompression variants also have in-out counts. Its single direct callback API is `inflateBack`; allocator callbacks embedded in `z_stream` are deliberately outside that column.

# Implications for nts

The following are design deductions from the findings, separate from the surveyed systems’ claims.

## 1. Preserve the provenance and strength of each fact

A useful binding record should distinguish a header fact, library-authored metadata, an implementation-analysis result, a reviewed documentation extraction, and an unresolved candidate. Attach the library version, target/build configuration, evidence and assumptions.

Inference can reduce manual work substantially, as 3C and the direct binding papers demonstrate. The measured error rates and explicit unsoundness boundaries do not support silently promoting every inferred result into a trusted ownership contract.

## 2. Separate native storage from value copying

Represent at least three cases distinctly: a copyable C-layout value, an addressable native allocation, and state whose address/protocol must remain stable. Layout agreement does not prove that copying is meaningful.

`z_stream` duplication and immovable libuv handles are concrete tests. An ergonomic TS object representation can be useful for value structs, while persistent C state needs identity and controlled initialization/teardown.

## 3. Model rooting, address stability and permitted retention separately

Keeping a managed object alive does not by itself establish that its address is stable, its backing store cannot be detached/resized, or C may mutate it.

A pointer retained by C needs an owner and a named end event: return, completion, unregister-and-drain, replacement or destruction. Opaque context handles such as CFFI handles, OCaml roots and Haskell StablePtrs solve identity/rooting; they do not expose arbitrary managed objects as C records.

## 4. Make buffer relationships richer than adjacent pointer/length pairs

Useful contract facts include:

- bytes versus elements;
- element size, stride and dimension expressions;
- capacity on entry versus initialized/produced length on return;
- relations stored in fields or established by earlier calls;
- nullability conditional on zero length;
- retention until asynchronous completion.

A generated ergonomic operation can hide redundant counts when those relationships are known. It should retain an explicit representation when they are unresolved. Bun’s same-view pointer/byte-length snapshot is a useful local mechanism, but only one part of this larger contract.

## 5. Separate string conversion from allocation ownership

“Convert to a TS string” and “release the original C allocation” should be separate facts, even when one generated operation performs both. Specify encoding, termination/length, allocator family, and invalidation events.

Borrowed strings need more than “valid while owner is alive.” SQLite conversion, another curl operation, an environment update, or an SDL error update can invalidate a borrow while the apparent owner remains live. Copying a borrowed result at the boundary is an effective ergonomic option when its cost is acceptable.

## 6. Make output validity conditional on results

An `out` annotation should describe which bytes or slots become valid under which outcome. `writeonly` is insufficient.

Generated tuples/objects are attractive when outputs are well-defined, but failure paths can still contain resources requiring cleanup. SQLite opening is a useful test: a failure result does not necessarily mean “no object was produced.” In-out capacities also need their entry and exit meanings distinguished.

## 7. Treat errors as per-operation protocols

Avoid universal “nonzero throws,” “NULL throws,” or “errno changed throws” transformations. Preserve the success predicate and any immediate follow-up operation needed to interpret failure. Distinguish progress, EOF, retry and partial success.

For `longjmp` APIs, a generated or handwritten C adapter should keep the protected operation, jump target and native cleanup within an active C frame, then return an ordinary status. ResourceFlow cannot account for cleanup that an unsupported nonlocal exit skips.

## 8. Give resources state transitions, including release outcomes

Unique ownership, shared references and borrowed dependent objects need distinct operations. The existing GObject counting path provides a concrete shared-ownership case; naming conventions such as `ref`/`unref` are insufficient, as libuv demonstrates.

Release needs explicit outcomes:

| Release behavior | Example |
|---|---|
| Failure preserves the resource | `sqlite3_close` returning busy |
| Resource is consumed despite an error result | `sqlite3_finalize` |
| Logical close precedes physical destruction | `sqlite3_close_v2` |
| Storage remains required until completion | `uv_close` |

Finalizers can be fallback mechanisms or participate in library-supported deferred destruction. They cannot silently choose application policy for retryable or fallible release.

## 9. Split callback contracts into independent dimensions

At minimum: lifetime, call count, context ownership, submission-failure behavior, possible invocation during registration/destruction, thread domain, synchronous result requirements, exception translation and re-entrancy.

“Once” needs qualification: an accepted operation may complete once, while rejected submission never calls back. “Retained” does not mean “first called after return.”

A foreign-thread callback that must return a decision immediately cannot be implemented by merely posting work to an owner thread and ignoring the result. SDL timers and OpenSSL selection callbacks are useful tests. Catching an exception also needs an API-specific C result; zero is not a universal failure value.

## 10. Preserve unknown nullability explicitly

Unknown should not silently become non-null. Conversely, a zero-length buffer should not automatically become nullable unless its API permits that combination.

Distinguish nullable input, optional output slot, absent result, failure sentinel and zero-length data. These can have identical C pointer types but different application meanings. Proof or authoritative metadata can strengthen a contract; a naming heuristic should remain a proposal.

## 11. Let the C compiler preserve header-defined behavior

The existing witness is valuable for layout/type agreement. Generated C wrappers can additionally preserve macro and inline semantics, including hidden platform arguments and version/size checks.

Enums and flags need ABI representation plus semantic policy: whether arbitrary values/bits are accepted is not established by discovering constants. Function-like macro translation should be limited to forms whose behavior is actually preserved; a compiled wrapper is a broadly applicable alternative.

## 12. Specialize variadic protocols into typed operations where possible

Two especially useful cases are fixed typed call shapes and option-dependent APIs such as `curl_easy_setopt`/`getinfo`.

For printf-like calls, explicit promoted C argument types and checks against literal formats can catch real errors. They do not solve arbitrary runtime format strings. A `va_list` parameter is a separate ABI object, not an invitation to pass a TS array.

## 13. Keep the three safety obligations visible

The obligations are:

1. **ABI agreement:** checked by the witness and target C compiler.
2. **Contract correctness:** established through authoritative metadata, reviewed assertions or sound analysis under stated assumptions.
3. **Program compliance:** checked by ResourceFlow and appropriate runtime guards.

ResourceFlow can verify use of a correct ownership contract; it cannot make an incorrect inferred contract true. Runtime guards can check known lengths, arithmetic, null conditions and state, but cannot generally validate arbitrary foreign addresses.

A meaningful nts coverage metric would therefore report **public functions with complete justified contracts, facts inferred correctly, facts left unknown, and unsafe proposals rejected**. Pointer-conversion percentages and absence of analyzer warnings are useful research evidence, but do not measure that outcome.
