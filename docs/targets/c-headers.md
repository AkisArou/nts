# C headers

How nts turns a C library's headers into a typed binding: what `nts bind-c`
does today, how C's number types become TypeScript types, and the design for
binding whole libraries. For anyone binding a C library, and for the work on
the binder. What a binding is, the binding vocabulary, strings, callbacks and
the witness are on the [native](native.md#calling-c) page; this page does not
repeat them.

## Status

| part | state |
|---|---|
| Binding named items from headers (`nts bind-c`) | built |
| A name for every C number type, interchangeable with the fixed widths | decided; the first to build |
| Binding whole headers, with an overrides file | decided, after ResourceFlow |
| Ownership checked across the boundary (ResourceFlow) | decided, not built |
| Function-like macros and `static inline` functions | open |

## Binding named items: `nts bind-c`

`nts bind-c` reads a library's headers through clang and writes a `c:`
declaration module for the items it is given: functions (`--fn`), structs and
unions (`--record`) and constants (`--const`). `nts build` runs the same
generator for a `c:` module that `nts.config.ts` declares with a `header`
([reference](../reference/cli.md#nts-bind-c)).

- **What it reads:** clang's AST (`-ast-dump=json`) for the declarations, and
  clang's layouts (`-fdump-record-layouts`) for every record, which the
  compiler recomputes by its own rules and refuses, with both numbers, where
  they differ.
- **What C it can spell:** the C number types (below), pointers and `const`,
  `void *`, inline arrays, bit-fields, flexible array members, structs and
  unions (anonymous ones included), function pointers, and enumerators and
  macros read out as constants. Anything else is refused by name, never
  approximated: a binding that describes the wrong type is worse than none.
- **What it cannot know:** a header does not say what a callee keeps, who
  frees a returned pointer, what may be null, which pointer goes with which
  length, which arguments are outputs, or how errors are reported. The author
  states what a callee keeps (`--no-escape`) and types a variadic tail; the
  rest is written by hand on top of the binding.
- **What checks it:** the witness compiles every binding against the real
  headers when the program is built ([native](native.md#the-witness)).

## C's number types

A C number type becomes a kind from `@nts/scalars`
([numbers](../language/numbers.md#scalar-types)).

- **A C type that is the same on every target is the fixed-width kind.** Where
  a C type's width and signedness are the same on every target nts builds for,
  its name is an alias of the fixed-width kind: `c_int` and `Int32` are one
  TypeScript type, so they mix freely, in arrays, function types and
  overrides included.
- **A C type that depends on the target is a kind of its own.** A build for
  several targets accepts a value into one only where it fits on every target.

| C | kind | the same on every target |
|---|---|---|
| `signed char`, `int8_t` | `c_schar` = `Int8` | yes |
| `unsigned char`, `uint8_t` | `c_uchar` = `Uint8` | yes |
| `short`, `int16_t` | `c_short` = `Int16` | yes |
| `unsigned short`, `uint16_t` | `c_ushort` = `Uint16` | yes |
| `int`, `int32_t` | `c_int` = `Int32` | yes |
| `unsigned int`, `uint32_t` | `c_uint` = `Uint32` | yes |
| `long long`, `int64_t` | `c_longlong` = `BigInt64` | yes |
| `unsigned long long`, `uint64_t` | `c_ulonglong` = `BigUint64` | yes |
| `float` | `c_float` = `Float32` | yes |
| `double` | `c_double` = `Float64` | yes |
| Windows' `LONG` and `ULONG` | `c_long32` = `Int32`, `c_ulong32` = `Uint32` | yes |
| `_Bool` | `boolean` | yes |
| `char` | `c_char` | no: unsigned on Linux and Android Arm, signed elsewhere, so a value fits every target only from 0 to 127 |
| `long`, `unsigned long` | `c_long`, `c_ulong` | no: 64 bits on Linux and macOS, 32 on Windows |
| `size_t`, `ssize_t`, `ptrdiff_t`, `intptr_t`, `uintptr_t` | `c_size_t`, `c_ssize_t`, `c_ptrdiff_t`, `c_intptr_t`, `c_uintptr_t` | no: as wide as a pointer |
| `wchar_t` | `c_wchar` | no: 16 bits on Windows, 32 elsewhere, signed on some targets and unsigned on others |
| `long double` | refused | no |
| an `enum` | `CEnum<E, kind>`, the enum and the kind C holds it in | as its kind |

- **The label stays one per kind.** Each fixed width carries an optional label
  of its own, which TypeScript checks nothing about, so a `Uint8` still goes
  where a `Uint16` is written and nts proves the value fits. One shared label
  with a value per kind would make TypeScript itself reject a `Uint8` where a
  `Uint16` is written. A C name is an alias of a kind, never a label of its
  own.
- **The binding keeps C's spelling.** `int` and `int32_t` are two C types even
  at one width, and `int64_t` is `long` on Linux but `long long` on macOS and
  Windows. The name a binding writes (`c_longlong` or `BigInt64`) is recorded
  with the declaration, and the witness and the emitted C use the C type that
  name stands for. The TypeScript type is the same either way.
- **An enum is never an intersection.** A C enum parameter is
  `CEnum<E, kind>`; an intersection such as `LocaleCategory & c_int` names no
  single representation and is refused.

Today's binder writes `signed char`, `short`, `long long`, `float` and
`double` as `Int8`, `Int16`, `BigInt64`, `Float32` and `Float64`; `int` and
`unsigned int` are kinds of their own; `ssize_t` is written as `c_ptrdiff_t`;
and `c_schar`, `c_uchar`, `c_short`, `c_ushort`, `c_longlong`,
`c_ulonglong`, `c_float`, `c_double`, `c_ssize_t`, `c_intptr_t` and `c_wchar`
do not exist.

## Whole libraries

After ResourceFlow, `bind-c` binds whole headers, with an overrides file
([decisions](#decisions)):

- **Everything the library's own headers declare,** not the system headers
  they include. Each item is bound or refused by name with its reason, in a
  report beside the binding.
- **An overrides file per library** states what the headers cannot: who frees
  a returned pointer and with which function, what a callee keeps, what may be
  null, a pointer and its length (`Counted`), outputs and the error convention
  (`@ntsThrows`), and the TypeScript names. An ownership fact is enforced by
  ResourceFlow, never trusted as an unchecked annotation.
- **Clang's own annotations are read** where a header has them (`_Nullable`,
  `_Nonnull`, `counted_by`, `malloc` and the ownership attributes), so a
  well-annotated header needs fewer overrides.

## Open questions

- **Macros and `static inline` functions** have no symbol to call. Proposed:
  the binder emits a small C shim for each one a program uses, compiled into
  the program and checked by the witness like any other binding.
- **The overrides file's form.** Proposed: TypeScript, typed by a declaration
  module, so the editor and the checker read it as they read the binding.
- **Variadic functions** beyond the rest parameter a binding types for each
  shape today, such as `printf`'s family.
- **The libraries that drive it first.** Proposed: the ones `runtime/node`
  already bundles (zlib, llhttp, libuv), then SQLite as an outside test.

## Decisions

- ResourceFlow comes with its enforcement, and after it `bind-c` binds whole
  headers, with an overrides file (I-5, B-1,
  [log](../records/notebooks/decisions-log.md#memory-concurrency-and-interop-10-28)).
- C's number types, decided by the user on 10-29 and built first. A C type that
  is the same on every target is an alias of the fixed-width kind. One that
  depends on the target is a kind of its own. Each fixed width keeps a label
  of its own, and a binding keeps the C type it was written with
  ([log](../records/notebooks/decisions-log.md#compiler-10-29)).
