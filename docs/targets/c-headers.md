# C headers

How nts turns a C library's headers into a binding: what `nts bind-c` reads,
how C's number types become TypeScript types, and how whole headers are bound.
For anyone binding a C library, and for the work on the binder. How a program
calls the binding, and the contract each call keeps, is
[Calling C](calling-c.md); the witness and the native targets are
[native](native.md).

## Status

| part | state |
|---|---|
| Binding named items from headers (`nts bind-c`) | built |
| A name for every C number type, interchangeable with the fixed widths | decided; the first to build |
| Binding whole headers directly, with no file of facts beside them | decided, not built |
| A binding per target, from that target's headers | decided, not built |
| The header's attributes read: nullability, enum openness, `format`, `counted_by` and the rest | decided, not built |
| C shims for function-like macros and `static inline` functions | decided, not built |

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
  macros read out as constants. Enum-typed parameters, fields and results are
  refused today. Anything else is refused by name, never approximated: a
  binding that describes the wrong type is worse than none.
- **What a header cannot say,** and the binding therefore does not state: what
  a callee keeps, who frees a returned pointer, which pointer goes with which
  length, which return value means failure. The program keeps those
  obligations as a C program would ([Calling C](calling-c.md#two-layers)).
  Today's `--no-escape` flag, which writes `@ntsNoEscape`, is for bindings
  written by hand; a generated binding carries no such facts.
- **What checks it:** the witness compiles every binding against the real
  headers when the program is built ([native](native.md#calling-c)).

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
`double` as `Int8`, `Int16`, `BigInt64`, `Float32` and `Float64`, so a
`long long` is spelled `int64_t`, which is a different C type on Linux. `int`
and `unsigned int` are kinds of their own; `ssize_t` is written as
`c_ptrdiff_t`; and `c_schar`, `c_uchar`, `c_short`, `c_ushort`, `c_longlong`,
`c_ulonglong`, `c_float`, `c_double`, `c_ssize_t`, `c_intptr_t` and `c_wchar`
do not exist.

## Whole headers

`bind-c` binds a library's whole headers directly, with no file of facts
beside them:

- **Everything the library's own headers declare,** not the system headers
  they include: functions, records, enums, constants, function-like macros and
  `static inline` functions. Each item is bound or refused by name with its
  reason, in a report beside the binding.
- **Per target.** A binding is generated from each target's headers, with
  that target's layouts and number widths, and the witness checks each. A
  build for several targets type-checks against what every one of them
  declares: a function one target lacks, or a record laid out differently
  (`struct stat`, x86-64's packed `epoll_event`), is used only through a
  target's own module.
- **What it reads beyond the types,** every attribute clang keeps, each with
  one use:

  | attribute | use |
  |---|---|
  | `_Nullable`, `_Nonnull`, `nonnull`, `returns_nonnull` | which pointers may be `null` ([null](calling-c.md#null)) |
  | `enum_extensibility`, `flag_enum` | an enum's openness, and flags |
  | `format` | a literal format string checked, and any other refused |
  | `counted_by`, `sized_by` on a struct field | a count larger than a TypeScript-owned buffer throws a `RangeError` |
  | `noescape` | a value lent there may be released at its last use, not its block's end |
  | `ownership_returns`, `ownership_takes`, `malloc(deallocator)` | the releasing function, named in the binding's documentation and not enforced |

  Every other attribute is ignored. Upstream clang cannot put a count on a
  function parameter, and glibc writes its buffer and deallocator attributes
  only for GCC, so they are absent from a clang-read glibc.
- **Constants** come through clang: integers, strings, floating point, and a
  macro that casts to a pointer (`SQLITE_TRANSIENT`, `MAP_FAILED`) as a typed
  pointer constant. An extern variable (`stdout`, `optarg`, `environ`) is a
  property that reads and writes the global.
- **Function-like macros and `static inline` functions** become C functions
  that nts generates from the header, compiles into the program and checks
  with the witness, so every target calls them through a real symbol. A macro
  is bound when it expands to a single call whose arguments are its own
  parameters, which take that callee's types (zlib's `deflateInit` calls
  `deflateInit_`); any other is refused by name, with the reason.
- **Refused by name:** `va_list` parameters; the functions that return twice
  (`setjmp`, `sigsetjmp`, `_setjmp`, `vfork`); and a TypeScript function as a
  signal or exit handler (`signal`, `sigset`, `bsd_signal`, `sigaction`'s
  handler fields, `atexit`), which take C functions only
  ([Calling C](calling-c.md#callbacks)).

## Open questions

- **Explicit alignment** (`_Alignas`, `__attribute__((aligned))`,
  `#pragma pack(n)` with `n` above 1) has no vocabulary, so such records are
  refused by the layout check.
- **Bit-fields on Windows** need Microsoft's placement, not built, so such
  records are refused.
- **Records by value** still refused on some ABIs: System V unions, AAPCS64
  floating-point aggregates and arguments over 16 bytes, and arm64 Windows.

## Decisions

- Bind whole headers directly, per target, with no file of facts: a binding is
  the C API as the header declares it, and refined APIs are written over it
  ([Calling C](calling-c.md#decisions)). This replaces the overrides file
  decided on 10-28 (B-1); decided by the user on 10-30
  ([log](../records/notebooks/decisions-log.md#calling-c-10-30)).
- C's number types, decided by the user on 10-29 and built first. A C type that
  is the same on every target is an alias of the fixed-width kind. One that
  depends on the target is a kind of its own. Each fixed width keeps a label
  of its own, and a binding keeps the C type it was written with
  ([log](../records/notebooks/decisions-log.md#compiler-10-29)).
