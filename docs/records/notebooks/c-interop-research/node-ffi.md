# node:ffi, as read on 30 October 2026

Source: <https://nodejs.org/api/ffi.html> (Node.js v26.13.0 docs), read with
WebFetch. Node 26 is the latest LTS line (26.13.0, 28 October 2026, per
nodejs.org/en/about/previous-releases). nts's node oracle is v24.20.0, which
does not have it.

## What it is

- Added in **v26.1.0**; `Stability: 1 - Experimental`; "This API is unsafe."
- On by default in builds with FFI support; `--no-experimental-ffi` disables
  it; under the permission model it needs `--allow-ffi`. Bundled libffi.
- `dlopen(path, definitions)` returns `{ lib, functions }`;
  `new DynamicLibrary(path)` resolves lazily; `dlopen(null)` resolves from the
  process (not on Windows). The handle supports `using`.
- A signature is `{ arguments: [type names], return: type name }`.
- Types: `void`, `char`, `int8` to `uint64`, `float32`, `float64`, `pointer`,
  `string`, `buffer`, `arraybuffer`, `function`. `bool` is `uint8`, and JS
  booleans are not accepted.
- **No structs, no arrays (besides buffers), no variadic functions, no
  allocator and no free.**
- Pointers are `bigint` addresses. 64-bit returns are always `bigint`; 64-bit
  arguments accept a `bigint` or a safe-integer `number`.
- Strings are copied to temporary NUL-terminated UTF-8 for the call. Buffers,
  typed arrays and `ArrayBuffer`s pass their backing memory, borrowed for the
  call.
- Memory helpers: `getInt8` to `getFloat64` and `setInt8` to `setFloat64` at a
  pointer and byte offset; `toString`, `toBuffer` and `toArrayBuffer` (copy,
  or a zero-copy view); `exportString` and the other `export*` helpers;
  `getRawPointer`.
- Callbacks: `lib.registerCallback(signature, fn)` returns a `bigint` pointer;
  `unregisterCallback`, `refCallback`, `unrefCallback`. A callback must run on
  the thread that created it, and must not throw or return a promise. They are
  built on libffi closures and need executable memory.
- No errno capture. Ownership: "whether the caller must free the returned
  address depends entirely on the native API."
- Three call paths, chosen automatically: a V8 Fast API trampoline (up to 8
  register arguments, no `function` types), a shared argument buffer, and
  generic libffi.

## How nts could use it (proposed, not decided)

1. **A node oracle for C interop.** Generate, from each `c:` binding, a node
   implementation over `node:ffi`, so C-interop programs run under node as the
   reference and natively under nts:
   - functions through `dlopen`;
   - struct classes, `Ref` and `CArray` over Buffers, at the C offsets nts
     computes;
   - by-value structs and variadic calls through the C shims nts generates
     anyway.
   Today no node-compared test touches C (`nts-inventory.md`).
2. **Run `node:ffi` programs, compiled statically.** Literal definitions give
   every signature at compile time, so the calls are plain C calls with no
   libffi. Definitions built at run time fall back to a bundled libffi. This
   wants a benchmark row against node.
3. **It confirms the v3 design** on strings, borrowed buffers, 64-bit bigints,
   non-throwing same-thread callbacks, untracked ownership and `using`.
   Borrow one thing from it: accept a safe-integer `number` for a 64-bit
   parameter.

Prerequisite: move the node oracle from v24.20.0 to Node 26 LTS. That is a
separate decision, because it touches every recorded node result.
