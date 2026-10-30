# nts C interop: an inventory of what is built, decided and open

State of `main` at `c5549ea5a` (2026-10-30), read only. Written for a design
discussion about how nts binds C.

## How to read this

- **BUILT**: in code on `main`. Each item gives a `file:line` and one real
  example from the repository.
- **DECIDED**: written down as a decision but not in code. Each item gives the
  page section and its decisions-log entry.
- **OPEN**: neither decided nor built, or listed as an open question.
- Line numbers in documentation and in `runtime/native/libc.d.ts` are from
  `git show HEAD:<path>`. The working tree has the owner's uncommitted
  formatting edits, which move lines in `docs/targets/native.md`,
  `docs/foundations/numbers.md`, `docs/language/numbers.md`,
  `docs/records/0006-*.md`, `docs/records/notebooks/scalar-numbers.md` and
  `runtime/native/libc.d.ts`.
- **Uncommitted draft only**: `docs/targets/native.md` has an uncommitted
  section, "Native storage: `c:memory`". It holds a table of the storage
  operations and their rules, plus three new sentences about ResourceFlow ("A
  fact it does not have is unknown, never proof that nothing escapes or
  changes. Its vocabulary belongs to bindings, not to the language's memory
  model, and binding whole headers follows it"). Everything else in the
  uncommitted diffs is table and comment reformatting with no change in
  content (checked with `git diff -w --word-diff`). This document marks every
  claim that comes only from the draft.

Terms used below:

| term | meaning |
| --- | --- |
| binding | a `declare module "c:<name>"` block that describes a C library's ABI in TypeScript types and JSDoc tags |
| witness | `native_witness.c`, a generated C file that includes the real headers and is compiled `-fsyntax-only` before linking; it asserts that the binding agrees with them |
| bridge, trampoline | a generated C function with the foreign signature, which calls the compiled TypeScript function |
| retention | what a callee keeps of an argument after the call: `Unknown` (no claim made) or `NotRetained` (an authored claim) |
| counted family | a foreign object system whose references the compiler retains and releases itself (GObject, Objective-C, COM, a stack-scanning host such as Blink) |
| obligation | a store into a slot of a written scalar kind, which must be proved to fit or the build stops with NTS5001 |

## 0. Where the machinery lives

| piece | where |
| --- | --- |
| Binding vocabulary (`c:types`, `c:memory`, `c:pending`, the libc subset) | `runtime/native/libc.d.ts` (898 lines at HEAD) |
| Scalar kinds (`@nts/scalars`) | `runtime/native/scalars.d.ts` |
| Objective-C and Windows Runtime vocabularies | `runtime/objc/objc.d.ts` (`ObjcClass`:18, `Block`:35, `CString`:77), `runtime/winrt/winrt.d.ts` (`ComClass`:37, `HString`:71, `Copied`:93, `Delegate`:148) |
| JSDoc tags as parsed | `compiler/semantic-schema/src/schema.rs:1056` (`NativeAttributes`, about 40 tags) |
| ABI model: `Function`, `Role`, `Retention`, `Type`, `Pointee`, `Family`, `Record` | `compiler/core/src/hir/native.rs` (6,565 lines) |
| `c:types` brands read into that model | `compiler/core/src/hir/native/schema.rs` |
| Call lowering: `@ntsNoEscape`, `@ntsFree`, `@ntsThrows`, `Counted`, callback bridges | `compiler/core/src/hir/lower.rs:70148-70240`, `73962-74060`, `74670-74776`, `74930-75015` |
| `c:memory` intrinsics | `compiler/core/src/hir/lower/native_memory.rs:1520-1946` |
| Frame-storage escape check | `compiler/core/src/hir/native_storage.rs` |
| Refusal of `async` callback bodies | `compiler/core/src/hir/native_callback.rs` |
| Handle types a callback may take | `compiler/core/src/hir/bridges.rs` |
| Scalar fit (NTS5001) | `compiler/core/src/hir/obligations.rs` |
| Layout rules | `compiler/core/src/hir/layout.rs` |
| C emitter: prototypes, bridges, witness | `compiler/codegen/c/src/emit.rs:1184-1262`, `1421-1530`; `compiler/codegen/c/src/emit/native_memory.rs:505-1250` |
| LLVM by-value classification | `compiler/codegen/llvm/src/aggregate.rs` |
| Witness compiled at build | `tooling/cli/src/main.rs:7187-7241`, called from `link_c` at `7285` |
| `nts bind-c` | `tooling/cli/src/bind.rs`; driver `main.rs:527-600`; automatic binding during `nts build` at `main.rs:4497-4620` |
| Runtime helpers (strings, closures, callback entry, owner thread) | `runtime/c/nts_runtime.h`, `runtime/c/nts_runtime.c` |
| Tests | `tests/interop/native-*`, `c-from-ts` and `ts-from-c`: the wide `interop` step, which runs in the full run and not per landing (`tooling/gate/owed.mjs:150-158`). `compiler/codegen/{c,llvm}/tests/native.rs` and `compiler/core/tests/native_*.rs` run per landing under cargo. 37 directories in `tests/refusals` touch `c:` |

`tests/programs` and `tests/outcomes` import no `c:` module; four programs
use `@nts/scalars` only. Nothing in the node-compared corpora exercises C
interop.

---

## 1. Where binding facts come from

### BUILT

**What `nts bind-c` reads from clang.** It runs clang twice as a subprocess
(`bind.rs:310-363`):

- `-Xclang -ast-dump=json` gives the structure: records and members, the
  typedef table, prototypes with parameter names (leading underscores
  stripped, `bind.rs:1037-1046`), the `variadic` flag (`bind.rs:1058`) and
  `PackedAttr` (`bind.rs:740`).
- `-fdump-record-layouts` is used **only to check**. The tool recomputes each
  record's layout by the compiler's rules and refuses, printing both sets of
  numbers, when they differ (`bind.rs:1521-1557`).
- Constants go through a probe enum, `enum nts_bind_constants { nts_k_X = (X) }`,
  so a macro, an enumerator and `O_CREAT | O_WRONLY` all come back as one
  integer (`bind.rs:196-308`). They are written to a separate `.ts` file.

The type mapping is `bind.rs:1207-1349`. A spelling it does not know is
refused by name, never guessed.

| C | becomes |
| --- | --- |
| `char` | `c_char` |
| `int` | `c_int` |
| `int32_t` | `Int32` |
| `long long`, `int64_t` | `BigInt64` |
| `size_t` | `c_size_t` |
| `ssize_t`, `ptrdiff_t` | `c_ptrdiff_t` |
| `T *` | `Ptr<T>` |
| `const T *` | `ConstPtr<T>` |
| `void *` | `Ptr<void>` |
| `T[N]` | `CArray<T, N>` |
| `T[]` | `Flexible<T>` |
| a bit-field | `Bits<T, N>` |
| `R (*)(A)` | a TypeScript function type |
| a record at a call | `ByValue<T>` (`bind.rs:1736-1743`) |

`restrict` is dropped.

**What the author states by hand** (`Request`, `bind.rs:28-63`):

- `--no-escape f:p` becomes `@ntsNoEscape`, validated against the real
  parameter names (`bind.rs:1806-1830`).
- `--alias tag=Name` names a record.
- `--const NAME:brand` gives a constant a kind; the brand defaults to `c_int`.
- `--define` sets feature macros; `--clang` passes flags through.
- The type of a variadic tail. bind-c writes
  `...rest: unknown[] /* TODO: the tail's C type */` (`bind.rs:1952`), which
  deliberately does not compile.

Everything else is hand-written on top of the generated binding:

- nullability (`| null`);
- `string` instead of `ConstPtr<c_char>`;
- `@ntsFree`, `Counted`, `CBytes`, `CStrings`;
- the closure kinds;
- `@ntsThrows`, `@ntsDefault`;
- `CEnum`, `CBool`;
- `Owned`, `Consumed`.

**`nts build` binds by itself.** For a `c:` import that does not resolve,
from a `native: [sources({ header })]` entry, the build runs `bind-c` on
exactly the imported names. Value imports become `--fn` and type imports
become `--record`. It writes `types/c-<module>.d.ts` and passes no
`--no-escape`, aliases or constants (`main.rs:4497-4620`, test at
`tooling/cli/tests/build.rs:1487-1500`).

**Other generators read richer sources than a header:**

- `bind-gir` reads GIR's transfer, nullability, direction, throws and
  callback scope. It also *infers* `@ntsNoEscape` for out parameters
  (`tooling/cli/src/bind_gir/map.rs:235-238`).
- `bind-winmd` reads Windows metadata plus clang's widths.
- `bind-objc` reads Swift symbol graphs plus clang.

**Example.** `tests/interop/native-poll/bind.sh` runs
`--fn poll --no-escape poll:fds` and generates `types/poll.d.ts`:

```ts
/** Nothing of `fds` outlives the call -- an authored claim, which no header
 * states and this tool did not read anywhere.
 * @ntsNoEscape fds */
export function poll(fds: Ptr<PollFd>, nfds: c_ulong, timeout: c_int): c_int;
```

### DECIDED

- **Whole headers, with an overrides file, after ResourceFlow.** The file
  states ownership, retention, nullability, `Counted`, outputs, the error
  convention and names. Clang's `_Nullable`, `_Nonnull`, `counted_by`,
  `malloc` and ownership attributes are read where present. Source:
  `docs/targets/c-headers.md` "Whole libraries" (:101-117) and "Decisions";
  log `decisions-log.md:617` (B-1) and `:594` (I-5). `docs/plan.md:497`
  lists it in the **Backlog** ("noted, not scheduled").
- **C's number types become aliases where C's type is the same on every
  target.** `c_int = Int32` and `c_longlong = BigInt64`, and new names
  `c_schar`, `c_uchar`, `c_short`, `c_ushort`, `c_longlong`, `c_ulonglong`,
  `c_float`, `c_double`, `c_ssize_t`, `c_intptr_t` and `c_wchar`. A binding
  keeps the C spelling it was written with. Source: `c-headers.md` "C's
  number types" (:45-99); log `:769` (10-29), "built first". `c-headers.md`
  says today's binder still differs (:94-99).
- **Why this matters now.** "`runtime/node`'s C becomes TypeScript" (log
  `:387-399`): it "needs typed bindings generated from the libraries' headers,
  ownership of their handles and callbacks from C into TypeScript first".

### OPEN

- **The form of the overrides file.** Proposed: TypeScript, typed by a
  declaration module. **Which libraries go first.** Proposed: zlib, llhttp
  and libuv, then SQLite (`c-headers.md:118-128`).
- **Bindings are per target.** bind-c reads the host's headers; there is no
  target triple unless one is passed with `--clang`, and the build's
  automatic binding passes none either. The vocabulary has no per-target
  variant: `native-epoll/types/epoll.d.ts` notes that `epoll_event` is packed
  only on x86-64.
- **Shipping `libc.d.ts`.** It is not injected the way `lib.*.d.ts` is.
  Every project lists it by hand (`main.rs:4505-4523` says "Nothing
  distributes it yet"). The 09-14 notebook entry in `native-interop.md` chose
  "inject it the way `tsc` injects `lib.*.d.ts`", and no spec page records
  that choice.

---

## 2. Struct layout, storage and copying

### BUILT

**Record vocabulary**, at `runtime/native/libc.d.ts`:

| type | line |
| --- | --- |
| `Struct<Fields, Tag>` | :489 |
| `Union` | :501 |
| `Packed<T>` | :514 |
| `Typedef<T>` | :534 |
| `CArray<T, N>` | :586 |
| `Bits<T, N>` | :602 |
| `Flexible<T>` | :617 |
| `Given<T>` | :204 |

An untagged member type needs no marker; it is inferred (:536-560). The model
is `Record` (`native.rs:1767`) with `Naming` = `Invented`, `Tagged`,
`Typedef` or `Untagged` (`native.rs:1806`).

**One layout routine** (`hir/layout.rs`) serves both backends and `sizeof`.
`program.c` asserts each record's size, alignment and offsets, and the
witness asserts them against the header (§13).

**Access.** `p.field` reads and writes at the C width. A member that is a
record or an array projects as a pointer to it (the `Ptr<T>` mapping,
`libc.d.ts:626-655`). `p[i]` indexes elements at the padded stride. A store
through a native pointer is an NTS5001 obligation (`obligations.rs:20-24`),
so `request.events = 1` must be proved to fit `Int16`.

**`local<T>(count?)`** (`libc.d.ts:700`; lowered at
`native_memory.rs:1892-1935`):

- `count` is a positive compile-time constant;
- the storage is zeroed;
- each function has a 65,536-byte budget (`native_storage.rs:10`);
- a local is refused in a suspending function unless it is confined to its
  block, and refused when it is carried into a later loop iteration;
- it may not escape (§3) (`native_storage.rs:39-57`).

**`sizeof<T>()`** works on complete types only (`native_memory.rs:1768-1805`).

**`copy(dst, src)`** requires the same pointee on both sides and refuses a
`const` destination. Overlap is not checked (`native_memory.rs:1806-1849`).
It emits `*d = *s` in C and `llvm.memcpy` in LLVM.

**`ByValue<T>`** (`libc.d.ts:169`, `native.rs` `Type::Record`):

- An argument is read from the storage it points at.
- A result is written into a `NativeLocal` destination, which is sret
  expressed in HIR, and so carries `local`'s rules.
- Refused (`native.rs:2850-2885`, `:2815`): an untagged record, a packed
  record, a record with a flexible member, and a record with a counted handle
  inside. An argument may lend handles from a stack-scanning family; a result
  may hold none. A variadic function returning a record is refused too.
- LLVM classifies by-value records for System V, Win64 and AAPCS64, each with
  named refusals (`aggregate.rs:1-49`).

**`Fields<T>`.** An object literal becomes a zeroed compound literal in the
caller's frame (`libc.d.ts:170-182`).

**Examples.** `tests/interop/native-byvalue/types/geometry.d.ts`:

```ts
export function point_add(a: ByValue<Point>, b: ByValue<Point>): ByValue<Point>;
```

`tests/interop/native-given/types/options.d.ts`:

```ts
export function options_report(label: string, options: ByValue<Options> | Fields<Options>): void;
```

### DECIDED

- Nothing specific to records. The LLVM backend is to state alias and
  dereferenceability facts to the optimizer ("designed, not built",
  `native.md:31-40`).

### OPEN

- **Explicit alignment has no vocabulary.** `_Alignas`,
  `__attribute__((aligned))` and `#pragma pack(n)` with `n > 1` cannot be
  written. bind-c knows only `PackedAttr`, so a record using the others is
  refused by its layout self-check.
- **Bit-fields on Windows.** MS placement is not implemented, so a record
  holding one is refused (`windows.md`, `native.rs:5287-5292`).
- **By-value refusals that remain:**
  - System V unions;
  - AAPCS64 arguments that are float homogeneous aggregates, and arguments
    over 16 bytes;
  - arm64 Windows altogether (`aggregate.rs:6-7`, `23-38`);
  - callbacks that take or return a record by value (`native.rs:2354-2357`).
- **A by-value result cannot outlive its frame.** The only way out is
  `copy` into `malloc` storage, which is manual. There is no owned record
  value.
- **Draft only.** The "Native storage" table restates these rules, but its
  `local` row leaves out the loop rule, the suspension rule and the
  65,536-byte budget, and its `copy` row leaves out the same-type rule.

---

## 3. Passing values by pointer: `Ptr`, `ConstPtr`, `addrOf`, `@ntsNoEscape`

### BUILT

**`Ptr<T>` and `ConstPtr<T>`** (`libc.d.ts:626`, `:656`). `const` is the
smaller type: a `Ptr<T>` is accepted where a `ConstPtr<T>` is wanted, and
the reverse is refused. A write through a `ConstPtr` is TypeScript's
`TS2542`, and lowering refuses it again.

**Conversions.** The legal set is `Pointee::converts_to`
(`native.rs:2035-2042`): any pointer to `void`, adding `const`, and a handle
upcast. Nothing turns a `void *` back into a typed pointer, and `Ptr<any>`
is refused.

**`addrOf(place)`** (`libc.d.ts:716`; `native_memory.rs:1520-1597`):

- only a property or element access is a place; anything else gets "addrOf
  needs a field or an element of native storage";
- the address of a member of a `const` view is refused;
- the result type must equal the addressed storage;
- a bit-field has no `__c_of` phantom, so `addrOf(h.ihl)` is a type error.

**`@ntsNoEscape`** (`lower.rs:74961-75003`). It is accepted on pointer
parameters and on function-pointer parameters, and narrows that slot to
`Retention::NotRetained`. The model's contract (`native.rs:1006-1018`): no
address is kept or returned, the storage is not freed, reallocated or
invalidated, and a callback is not called after the call returns.
`CStrings`, `CBytes`, `CElements` and `CHandles` parameters **require** it;
without it the call gets "a `CStrings`, `CBytes` or `CHandles` parameter
without `@ntsNoEscape`" (`lower.rs:75004-75015`).

**What the compiler checks** (`native_storage.rs`). It runs before
suspension and inlining, and again on prepared HIR.

- It tracks every alias of a `NativeLocal`: field and index addresses,
  pointer converts and block parameters.
- A use is safe only if it is one of: a load, a store through it, a bit-field
  access, a copy, `pointerBits`, `==` or `!=`, or a call where that argument
  is `NotRetained`. A direct TypeScript callee must earn that fact from its
  body; a runtime helper's comes from `runtime::keeps`.
- Every other use escapes (`borrowed`, `native_storage.rs:250-331`) and gets
  "native local address escapes: it may not be returned, stored, captured,
  freed, or passed to a retaining or unclassified callee" (`:52`).
- `escape.rs` reads the same retention, though it moves no allocation today
  (`escape.rs:1285-1320`).

**Example.** `tests/interop/native-callback/types/library.d.ts`:

```ts
/** ... Neither the callback nor the context outlives the call, which is what
 * lets the caller pass storage it owns for the duration -- a local.
 * @ntsNoEscape f
 * @ntsNoEscape ctx */
export function each_upto(f: (ctx: Ptr<Counter>, n: c_int) => void, ctx: Ptr<Counter>, upto: c_int): void;
```

### DECIDED

- **ResourceFlow**: checked ownership, borrowing, escape and cleanup over
  native operations. "The ownership vocabulary arrives together with its
  enforcement, never as an unchecked annotation." Source: `native.md`
  "Ownership of C pointers" (:332-350) and Decisions; `memory.md:486-489`
  (M5 covers the language, not bindings); log `:594` (I-5). Not built:
  `ResourceFlow` appears in no file under `compiler/`, `runtime/` or
  `tooling/`.

### OPEN

- **No checking of heap or C-owned pointers.** Bounds, alignment, lifetime,
  use after free and double free are all unchecked.
  `native.md:213-214` says so: "the caller's obligation".
- **No reads-versus-writes axis, and no acquire or release.** These are named
  as later axes (`native.rs:996-1004`).
- **No typed read through `void *`.** So `qsort` comparators and
  `pthread_create` contexts cannot read their data. The
  `native-operations.md` notebook says so at "What libc's own callbacks still
  need".

---

## 4. Buffers and counts: `CArray`, `Counted`, typed arrays, byte buffers

### BUILT

| type | what it is | where |
| --- | --- | --- |
| `CArray<T, N>` | inline array storage; reads decay to `Ptr<T>`, and it has no value form | `libc.d.ts:586` |
| `Flexible<T>` | a flexible array member with no extent; the count is unknowable | `libc.d.ts:617` |
| `CBytes<Q>` | a `Uint8Array`'s bytes, lent in place, no copy | `libc.d.ts:105` |
| `CElements<A, Q>` | any typed array's elements, the element type held to `Q` | `libc.d.ts:114` |
| `CHandles<H, Q>` | an array's own block of handle pointers; a hole ends the process | `libc.d.ts:127` |
| `CStrings<Q>` | a `string[]` converted to `char **`, NULL-terminated, released after the call | `libc.d.ts:79` |
| `Counted<A, L, At>` | the compiler passes the length in a slot of kind `L`, after or before the array | `libc.d.ts:132` |
| `bytesFrom(p, length)` | copies C bytes into a new `Uint8Array`; NULL with a non-zero length aborts | `libc.d.ts:772`, `:777`; `nts_runtime.c:10056-10064` |

All four lending types (`CBytes`, `CElements`, `CHandles`, `CStrings`) need
`@ntsNoEscape` (§3).

**How `Counted` passes its length** (`lower.rs:73962-74060`). The length is
the **element** count, not the byte count (`array_count`, `:74034-74060`).
A count slot narrower than 2^53 is bounded at run time with a `RangeError`
("an array too long for the `uint32_t` count").

**`malloc<T>(bytes)` and `free`** (`libc.d.ts:864`, `:867`) are typed and
manual. A non-integral count, a count below `sizeof<T>()` or zero returns
`null` without calling `malloc`.

**Example.** `compiler/codegen/c/tests/com.rs:1395`:

```ts
@ntsNoEscape value ... export function FromBytes(value: Counted<CBytes<"const uint8_t">, Uint32, "before">): IJsonValue;
```

### DECIDED

- **Arrays and lengths read from headers.** `counted_by` and an overrides
  file that pairs a pointer with its length (`Counted`), with whole headers
  (`c-headers.md:109-117`).

### OPEN

- **Typed arrays coming back from C.** A foreign function answering a typed
  array is refused: "a type with no native ABI is not supported by this
  lowering yet" (`tests/refusals/lib-dom-a-foreign-function-answering-a-typed-array`).
  There is no `elementsFrom` for non-byte arrays.
- **A buffer the callee keeps** cannot be declared: lending requires
  `@ntsNoEscape`.
- **An API that takes a byte count beside a non-byte array** has no
  vocabulary. `Counted` always passes elements.

---

## 5. Strings

### BUILT

**Encodings into C** (`native.rs:349-406`):

| type | C sees | how |
| --- | --- | --- |
| `string` | `const char *` UTF-8 | `nts_string_to_cstring`; ASCII lent in place, otherwise converted (`nts_runtime.c:7203-7217`) |
| `Utf16String` | `const uint16_t *` | lent in place when the string is already two bytes a unit |
| `HString` | Windows Runtime `HSTRING` | made for the call, deleted after |
| `StringView` | `const NtsBorrowedString *` | the string's own units, exact |

A lone surrogate becomes U+FFFD in UTF-8. A U+0000 inside the string aborts,
naming the index (`nts_runtime.c:6947`, `:7486`).

**Results** (`ReturnedString`, `native.rs:315-341`):

- copied with `nts_string_from_cstring`;
- `string | null` maps NULL to `null`;
- a plain `string` that comes back NULL **aborts**: "declare it
  `string | null`" (`nts_runtime.c:7540-7547`).

**`@ntsFree f`** (`lower.rs:74934-74960`). The C result becomes `char *` (or
`char **` for an array) and is freed with `f` after it is copied. Without
the tag, a string result is borrowed and never freed.

**`stringFrom(p)`** (`libc.d.ts:762`; `native_memory.rs:1657-1682`) reads a
`char *` from an out slot or a member. It is copied, never kept or freed, and
NULL is `null`.

**Strings in callbacks.** A callback's `string` argument is lent and copied
in. A **closure's** `string` result is a `malloc`'d copy that C takes over
(`native.rs:2393-2422`, `:2956-2986`). A bare function pointer's `string`
result is refused (`native.rs:2457-2460`).

**Example.** `tests/interop/native-string/types/text.d.ts`:

```ts
/** A fresh copy the caller owns, released after it is read.
 * @ntsFree free */
export function text_dup(s: string): string;
/** Declared `string`, and returns NULL: the call must not complete. */
export function text_broken_promise(): string;
```

### DECIDED

- `bind-gir` writes `@ntsFree` from GIR's transfer-full. For plain C, "who
  frees a returned pointer" belongs in the overrides file
  (`c-headers.md:109-113`), with ResourceFlow enforcing it.

### OPEN

- **A `string` argument the callee keeps.** `putenv` is the classic case.
  It can only be declared as a pointer, and nothing detects a binding that
  gets this wrong (§13).
- **Other encodings.** No Latin-1, no `wchar_t` strings on Linux (`c_wchar`
  is still only decided), and no length-delimited `(ptr, len)` text result.

---

## 6. Output and in-out parameters

### BUILT

**Plain C.** An output is a `Ptr<T>` slot the caller makes with `local<T>()`
and the binding marks `@ntsNoEscape`. The caller reads it back, with
`stringFrom` for a string slot. `Ptr<GError | null>` spells `GError **`
(`libc.d.ts:632-633`). Example, `tests/interop/native-void-pointer/types/void-pointer.d.ts`:

```ts
/** @ntsNoEscape out */
export function vp_fill(out: Ptr<Ptr<void> | null>, present: c_int): void;
```

**`@ntsThrows` error slots** (§7) are out parameters the compiler supplies
when the caller leaves them out.

**GIR "values forms".** `bind-gir` generates GJS-style tuples, as in
`const [width, height] = widget.getSizeRequest()`, but only for scalar out
slots (`bind_gir/emit.rs:817-849`). It treats inout record storage as the
caller's (`bind_gir/map.rs:2813-2830`). `@ntsVfuncOut` does the same for
overridden virtual functions (`schema.rs:1196-1202`).

**Windows Runtime.** `@ntsHresult out` reads the `[out]` slots into an
object (`native.rs:160-163`).

### DECIDED

- Outputs belong in the overrides file for whole headers
  (`c-headers.md:109-113`, B-1).

### OPEN

- **bind-c cannot tell outputs from inputs.** A header does not say which
  pointers are outputs, and nothing generates tuples for plain C.
- **No in-out strings for plain C.** `bind-gir` refuses a string inout
  ("a string out parameter", `bind_gir/map.rs:497`).

---

## 7. Errors: `@ntsThrows`, errno, return codes

### BUILT

**`@ntsThrows p converter`** (`native.rs:4645-4686`; lowering
`lower.rs:70148-70240`):

- the slot must be a pointer to a pointer;
- when the caller leaves it out, the compiler passes a zeroed slot and tests
  it before reading the result;
- on failure it gives back everything lent to the call, calls `converter`
  (assumed to be `char *f(E *)`), and throws an `Error` with that message.

The GLib converter is `nts_gerror_take_message` (`runtime/c/nts_glib_host.h:31-36`):

```c
/* ... The converter `bind-gir` names in
 * `@ntsThrows error nts_gerror_take_message` ... */
char *nts_gerror_take_message(struct _GError *error);
```

**Windows Runtime.** `@ntsHresult` throws on a negative HRESULT, with the
system's text.

**Objective-C.** `NSError **` becomes a throw.

**Return codes** are values the program tests itself.

**A callback that throws** stops the process (§9).

### DECIDED

- **Every host error becomes a catchable `Error` carrying the host value.**
  Unwinding through C frames is to be researched first. Source: log `:589`
  (I-2); `docs/language/errors.md` Decisions; `apple.md` (`NSException`).
- **The error convention** is part of the overrides file (`c-headers.md:111`).

### OPEN

- **errno has nothing at all.** No tag, no type, no design. `errno` appears
  in no file under `compiler/core/src`, nor in `native.md` or
  `c-headers.md`.
- **No convention for "returns -1 or NULL and sets errno"**, and no
  return-code mapping.

---

## 8. Handles and ownership

### BUILT

**Handle types** (`libc.d.ts`):

| type | line | what it is |
| --- | --- | --- |
| `Opaque<Tag>` | :17 | `struct Tag *`; no dereference |
| `Class<Tag, Parent>` | :32 | a single-inheritance chain; upcasts by TypeScript tuple assignability |
| `Const<H>` | :139 | `const H *` |
| `Erased<H>` | :143 | `void *` the binding still types |
| `Declared<T, D>` | :159 | a factory C declares as an ancestor; **trusted** |

`Typedef<H>` spells a handle by a typedef name. A model `Handle` carries its
tag, its ancestors, its `Family` and its spelling (`native.rs:1321-1345`).

**Families and their counting pairs** (`native.rs:1359-1563`):

| family | retain / release | null-safe? |
| --- | --- | --- |
| C | none: never counted | n/a |
| GObject | `g_object_ref_sink` / `g_object_unref` | no, so calls go through a guard |
| Objective-C | `objc_retain` / `objc_release` | yes |
| COM | `nts_com_addref` / `nts_com_release` | yes |
| a host (Blink's Oilpan) | the pair the binding names | no |

- A host handle is stack-rooted: it is counted only where it leaves the
  stack (`native.rs:1483`).
- Only GObject holds closures, which makes it the one cycle "holder family"
  (`native.rs:1493`; `NtsHolders` in the runtime).
- Handles may sit in arrays and erased values, tagged by family; a family
  mismatch aborts (`nts_runtime.h:930-938`).

**Ownership annotations** exist only for counted families:

- `Owned<T>` (`libc.d.ts:272`) marks a +1 result.
- `Consumed<T>` (`:276`) marks a parameter the callee takes over.
- On a plain C handle both are refused: "declare its class with
  `GObjectClass`, not `Class`" (`native.rs:4426-4478`).
- Objective-C's +1 results are inferred from the selector families `alloc`,
  `new`, `copy`, `mutableCopy` and `init` (`native.rs:247`).
- `Boxed<Tag, GetType, Size>` (`libc.d.ts:475`) covers GLib boxed records,
  copied when lent and freed by their box.
- `instanceof` is a checked downcast for GObject (`g_type_check_instance_is_a`,
  `lower.rs:76398-76506`) and Objective-C (`isKindOfClass:`, `lower.rs:76338`).

**Example.** `tests/interop/c-from-ts/types/counter.d.ts`:

```ts
export type Counter = Opaque<"Counter">;
export function counter_new(initial: c_int): Counter | null;
export function counter_destroy(counter: Counter): void;
```

### DECIDED

- **ResourceFlow**, for example "destroy what `counter_new` returned" and
  "unsubscribe before freeing the context" (`native.md:344-350`; log `:594`).
  The draft section adds that its vocabulary belongs to bindings.
- **Cycles through host objects are collected in memory stage 7.** That
  covers Windows Runtime delegates, the Objective-C classes nts defines,
  Chromium's joint collection, and N-API (log `:597`, I-6; `memory.md`
  "Build order" stage 7).
- **Objects cross the C ABI as opaque handles** "now" (log `:625`, S-2).
  Today `program.h` still publishes each exported object's layout
  (`native.md:286-330`).

### OPEN

- **No ownership vocabulary for plain C handles**, by decision until
  ResourceFlow.
- **`Ref`, `CFn` and `CStr` do not exist.** They appear only in the history
  notebook `native-interop.md` (`:789`, `:866`, `:931`, `:1013`), from the
  removed native-values RFC. The built equivalents are a plain function type
  (for `CFn`) and an uncounted `Opaque` (for `Ref`).
- **Cycles through Objective-C blocks**: M-4, the design is open.
- **Lifetimes of interior pointers.** A struct borrowed from an object, such
  as a `GtkTextIter`, is valid only while the object lives, and nothing keeps
  the object alive for it (`gtk.md` "Memory at the boundary").

---

## 9. Callbacks

### BUILT

**A bare function pointer.** A TypeScript function type in a binding is a C
function pointer (`native.rs:2326-2360`). The argument must be a
`ClosureStatic`, a function that captures nothing; otherwise the call gets
"a C function pointer needs a function declared with `function` ..."
(`lower.rs:74670-74700`, `74726-74776`). It becomes `OpKind::NativeBridge`,
emitted as a real C function with the foreign signature
(`codegen/c/src/emit/native_memory.rs:911-1100`). `null` is allowed only as
the literal, and only where the binding says `F | null` (`lower.rs:74705-74724`).

**Callbacks with a context** (`native.rs:2991-3104`; `Lifetime`, `:3226`):

| type | when C may call it | released |
| --- | --- | --- |
| `ScopedClosure<F>` | only during the call | after the call |
| `Closure<F>` | any time while C holds it | by the destroy notify |
| `OnceClosure<F>` | exactly once | after that call |
| `ErasedClosure<F, N>` | as GLib's `GCallback`, with notify type `N` | by the notify |

The shape is fixed: the callback's **last** parameter is `void *`; the
context slot comes **right after** the callback slot; for `Closure` the
destroy `void (*)(void *)` comes after the context. Neither the binding nor
the caller writes those slots. The context is
`nts_closure_lend(closure)` (`nts_runtime.h:2775-2792`).

**Families.** Objective-C blocks (`Block<F>`) and Windows Runtime delegates
(`Delegate<F, IID>`) are separate roles (`native.rs:438-461`).

**Exceptions.** Each bridge brackets the call with `nts_callback_enter` and
`nts_callback_leave` (emitter `:1062-1081`). While inside, a throw ends the
process, "nts: a callback threw across a C boundary that cannot carry it"
(`nts_runtime.h:3284-3291`; `errors.md:120-137`, status 1).

**Async bodies.** A suspending body is refused ("an `async` callback cannot
be bridged to C", `native_callback.rs:74`), except where the loop
checkpoints after callbacks, as GLib's does.

**Handle parameters.** A callback may take the same handle C passes, a base
of it, or a **descendant**. The descendant case is a trusted downcast with no
run-time test (`bridges.rs:126-141`).

**Threads:**

- `nts_callback_enter` aborts if not on the owner thread
  (`nts_runtime.c:2611-2618`).
- `nts_is_owner_thread` answers **true** when no host is installed
  (`nts_runtime.c:11766-11769`). So libraries and addons detect nothing.
- Objective-C blocks and COM delegates are *carried* to the owner thread
  (`codegen/c/src/emit/objc.rs:515` `nts_block_carry`; `emit/com.rs:136`
  `nts_com_carry`). Plain C bridges and GLib closures are not.
- `c:pending` brackets foreign async work (`libc.d.ts:802-813`).

**Example.** `tests/interop/native-closure/types/closures.d.ts` against
`native/closures.h`:

```ts
export function subscribe(f: Closure<(n: c_int) => void>): c_int;
```

```c
int subscribe(void (*f)(int, void *), void *data, void (*notify)(void *));
```

### DECIDED

- **Exceptions on UI targets** are reported and the loop keeps running; on a
  command line the process exits with status 1; a callback that must return
  a value is fatal everywhere. Source: log `:325-341`; `errors.md:126-131`
  (UI and observer handlers not built).
- **Threads nts does not own** follow one rule: every entry is checked, a
  callback is carried to the owner thread, and a call that must return a
  value from another thread is refused. Source: log `:581` (C-3, I-3);
  `gtk.md` Decisions ("Not built"); `plan.md` Backlog.

### OPEN

- **Context position is not configurable.** "Context first in the
  callback", as in SQLite's `sqlite3_exec` and BSD's `qsort_r`, cannot be
  expressed, and neither can a context placed before the callback.
- **Callbacks that take or return records by value.**
- **A variable that is a function on one path and `null` on another**
  (`lower.rs:74705-74710`).
- **Delegates with a result** (`native.rs:3033-3037`).
- **Throwing callbacks** pending the unwinding research (I-2).

---

## 10. Nullability

### BUILT

- **`| null` on a pointer or handle** has the same representation; NULL is
  `null` (`schema.rs:125-131`).
- **`F | null` on a callback** is "the API's claim, not a safety net"
  (`native.rs:2312-2320`).
- **Strings and string arrays are checked at run time.** A non-null `string`
  result that comes back NULL aborts (`nts_strings_from_cstrings(..., required)`,
  `nts_runtime.h:2645-2650`). A hole in `CHandles` or `CStrings` aborts.
- **A zero `@ntsConstant` on a non-nullable type** is refused
  (`lower.rs:9090-9098`).
- **GIR's nullability** becomes `| null` in `bind-gir`.

**Example.** `tests/interop/native-string/types/text.d.ts`
`text_maybe(which: c_int): string | null;` against
`text_broken_promise(): string;`, which aborts on NULL. Also
`native-void-pointer`'s `vp_address(present: c_int): Ptr<void> | null;`.

### DECIDED

- **Read clang's `_Nullable` and `_Nonnull`**, and state nullability in the
  overrides file (`c-headers.md:109-117`, with B-1).

### OPEN

- **Non-null handle and pointer results are not checked at run time.** No
  check of the kind `string` has was found for `Opaque`, `Class` or `Ptr`
  results.
- **bind-c types every pointer non-null** (`Shape::spell`,
  `bind.rs:1702-1709`, never adds `| null`). For results this is the unsafe
  default.
- **Not established by this read:** whether the optimizer uses a declared
  non-null type to fold `p === null`.

---

## 11. Enums, flags, constants and macros

### BUILT

**`CEnum<E, B>`** (`libc.d.ts:148`; `native.rs:5888-5946`). An enum crosses
as the integer kind `B`. Members pass with no cast, and a member of another
enum does not.

**`CBool<B>`** (`libc.d.ts:152`; `native.rs:5948-5969`). A boolean held in an
integer; any non-zero value reads as `true`.

**`@ntsConstant v`** on an ambient `const` is folded where it is read
(`lower.rs:9058-9125`). It works for a scalar, or for an uncounted data
pointer whose bits are kept exactly. Hex values work only for pointers
(`parse_handle_constant`). Example, `tests/interop/native-pointer-constants/types/constants.d.ts`:

```ts
/** @ntsConstant 65535 */
export const BROADCAST: Window;
```

**`bind-c --const NAME:brand`** evaluates macros, enumerators and constant
expressions through clang and writes a `.ts` constants module. A name the
headers declare is refused, naming `--alias` (`native-operations.md`
"Constants"; `native-epoll/src/constants.ts`).

**GIR enums and flags** become TypeScript enums (`gi:gtk` `Orientation.VERTICAL`).

### DECIDED

- **Enums become `CEnum<E, kind>`** in the number-type mapping, and an
  intersection such as `LocaleCategory & c_int` is refused (`c-headers.md:77`,
  `:90-93`; log `:769`). bind-c does not do this today (see Open).

### OPEN

- **bind-c cannot bind an `enum` type** as a parameter, field or result.
  `shape` has no `enum` arm and refuses ("a C type this does not know how to
  spell", `bind.rs:1324-1336`). It reads enumerators only as constants.
- **Function-like macros and `static inline` functions.** Proposed: a C shim
  per use, checked by the witness (`c-headers.md:120-123`).
- **Not established by this read:** whether a `CEnum` value C returns is
  trusted to be one of `E`'s members as a compile-time fact.

---

## 12. Variadic functions

### BUILT

- **The tail is a typed rest parameter** (`Function::variadic`,
  `native.rs:46-58`). Each tail argument is passed as the declared type,
  ungathered.
- **Refused** (`native.rs:5187-5240`, `:2815`):
  - a promoted type, with the promoted type named: `Uint16` gives "declare
    `int`", and `float` gives "declare `double`";
  - no fixed parameter before `...`;
  - records through `...`;
  - a variadic function that returns a record.
- Two shapes need two declared names.
- Objective-C sends are never variadic (`objc_msgSend` is cast per call).

**Example.** `tests/interop/native-open/types/fcntl.d.ts`:

```ts
export function open(path: ConstPtr<c_char>, flags: Flags, ...mode: Mode[]): Fd;
```

### DECIDED

- Nothing beyond what is built.

### OPEN

- **"Variadic functions beyond the rest parameter a binding types for each
  shape today, such as `printf`'s family"** (`c-headers.md:125-126`).
- **A tail holds one type.** A `string` tail has no ABI type, so it is
  refused.

---

## 13. Safety checking: the witness, refusals, unsafe operations

### BUILT

**The witness** (`codegen/c/src/emit.rs:1184-1262`;
`emit/native_memory.rs:505-760`). It is compiled at every native build with
`-std=c11 -Wall -Wextra -Werror -fsyntax-only`, in both C and LLVM builds
(`main.rs:7187-7241`, from `link_c` at `:7285`). It contains:

- the `@ntsDefine` macros first, then every `@ntsHeader` the program reaches,
  then `stddef.h`, `stdint.h` and `stdbool.h`;
- per record whose module names a header: `sizeof`, `_Alignof`, every
  `offsetof`, and `_Generic(&p->field, T *)` for type identity. Bit-fields
  get the size check only;
- forward declarations for opaque tags;
- per function actually called whose module names a header:
  `_Static_assert(sizeof(&f) > 0, ...)` (the header declares it) and
  `__builtin_types_compatible_p(__typeof__(f), <type>)` (`:700-745`);
- per function with no header: a bare `extern` re-declaration, which
  compares against nothing.

**Where the witness does not reach** (`witnessable`, `:830-845`):

- Objective-C messages and COM vtable calls;
- any function whose signature names a managed type, including
  `@ntsAbi managed`;
- records and functions of a module with no `@ntsHeader`;
- unused declarations.

**bind-c's own self-check** compares against the same clang that generated
the binding, so it is no substitute for the witness (`bind.rs:1518-1520`).

**Refusals.**

- Lowering diagnostics (`NTS1001`) and `program.uncompiled`.
- NTS2006, "no layout".
- NTS2007, conflicting ABI for one symbol (`codegen/common/src/abi.rs:69`,
  `:149`; `emit.rs:1473-1506`).
- NTS5001, scalar fit, with only local facts proving it.
- Any refusal fails `nts build` unless `--partial` is given.
- Examples: `tests/refusals/a-struct-argument-with-a-gobject-member` expects
  "NTS1001 foreign function `gevent_new` passes `EventInit` by value, and its
  member `relatedTarget` is a counted handle", and
  `tests/refusals/pointer-bits-by-assertion`.

**Unsafe operations:**

- **`pointerBits(p)`** (`libc.d.ts:733`; `native_memory.rs:1684-1736`) gives
  a data pointer's bits as `c_uintptr_t`. It reads nothing and is not an
  escape. Function pointers are refused. Nothing turns an integer back into a
  pointer, except a binding's `@ntsConstant`.
- **`unsafeDowncast<T>(v, is)`** (`libc.d.ts:791`; `native_memory.rs:1601-1655`)
  works on handles only, and `T` must be a strict descendant. `is` is
  trusted.
- **`malloc` and `free`** are manual. `free` accepts any native pointer, and
  only `local` storage is refused by the escape check.

### DECIDED

- **ResourceFlow** and whole-header binding (I-5, B-1), as above.
- **A diagnostic registry** listing every code (log, L21; `cli.md`
  Decisions). Not built.

### OPEN

- The overrides file's form; macro and `static inline` shims; variadics
  beyond one tail type (`c-headers.md` Open questions).

---

## Contradictions

### Between pages and code

1. **`runtime/native/README.md` is stale in several places.**
   - It says "C function-pointer callbacks, variadic functions, structs by
     value, and ResourceFlow ownership checking remain outside the
     implemented surface". All but ResourceFlow are built (§9, §12, §2).
   - It says "runtime containers of handles" and "Boxing into `unknown`" are
     refused. Arrays of handles and erased handles exist
     (`nts_runtime.h:930-938`, `CHandles`).
   - It says LLVM's aggregate calls "target the AMD64 System V ABI". Win64
     and AAPCS64 are implemented (`aggregate.rs`).
   - It calls the notebook "the native operations contract".
2. **`unsafeDowncast`'s documentation describes a generator that does not
   exist.** `libc.d.ts:782-788` (committed) and the draft "Native storage"
   row both say "a generated binding wraps the call in one checked helper per
   class (`asGtkBox(v)`)". No generator emits such a helper: `unsafeDowncast`
   has no caller in `tooling/` or `runtime/`. GTK narrows with `instanceof`,
   which calls `g_type_check_instance_is_a` (`lower.rs:76398-76506`).
3. **`native.md` says a string result is never freed.** Its "Strings at the
   boundary" (:219-231) says "A `string` result is copied ... The C pointer
   is neither kept nor freed." With `@ntsFree f` the pointer *is* freed, and
   its C type changes to `char *` (`lower.rs:74934-74960`). `@ntsFree` is not
   in `native.md`'s tag table (:139-148) either. That table lists 8 tags;
   the schema parses about 40 (`schema.rs:1056-1260`). Missing ones that
   matter for C include `@ntsFree`, `@ntsDefine`, `@ntsSymbol`,
   `@ntsGet`/`@ntsSet` and `@ntsVfuncOut`. The aborting NULL rule for a
   plain `string` result is not on the page either.
4. **Unchecked ownership annotations already exist.** The principle in
   `native.md:344-350` and log I-5 is "the ownership vocabulary arrives
   together with its enforcement, never as an unchecked annotation". Today's
   `@ntsFree` (a plain C ownership claim), `@ntsNoEscape` (an escape claim),
   and `Owned`/`Consumed` (transfer claims) are all trusted, unchecked
   annotations in use. This needs reconciling in the design.
5. **A code comment contradicts its own emitter.** The comment on the
   witness emitter (`codegen/c/src/emit/native_memory.rs:490-494`) says
   "There are no `#include` lines for the bindings ... inventing one here
   would assert something nobody told us". `witness_file` (`emit.rs:1228-1238`)
   includes every named header. The notebook records that this decision was
   reversed.
6. **The `native.md` example does not match its fixture.** `native.md:116`
   declares `c:counter` under `@ntsHeader "counter.h"`. The real
   `tests/interop/c-from-ts/types/counter.d.ts` names no header, so its
   witness compares nothing (only bare `extern`s). The notebook's description
   of that fixture ("39 TypeScript errors", a callback, an out-parameter) is
   stale too.
7. **`c-headers.md` overstates what bind-c can spell.** "What C it can
   spell" (:32-36) and the table row "an `enum` → `CEnum<E, kind>`" (:77)
   read as current. bind-c refuses enum-typed parameters, fields and results;
   it reads enumerators only as constants. The "Today's binder" paragraph
   (:94-99) does not say so.
8. **The by-value ABI claim leaves out its refusals.** `native.md:31`
   ("classifies records passed by value for System V, Win64 and AAPCS64")
   omits the named refusals in `aggregate.rs`: System V unions, AAPCS64
   float-aggregate arguments and arguments over 16 bytes, and arm64 Windows.
   `windows.md`'s "Refused by name" list omits by-value records on arm64
   Windows.
9. **The object-handle decision is unmarked.** S-2 says objects cross the C
   ABI "as opaque handles now" (log `:625`). `native.md` Decisions carries it
   with no "Not built" marker, while its body (:286-330) documents published
   layouts as current.
10. **The definition of `@ntsNoEscape` is narrower on the page than in
    code.** `native.md:145` gives "the callee keeps nothing of `p` past the
    call". The code's contract also excludes freeing, reallocating or
    invalidating, covers callbacks ("not called after the call"), and is
    *mandatory* for `CStrings`, `CBytes`, `CElements` and `CHandles`
    (`native.rs:1006-1018`; `lower.rs:75004-75015`).
11. **The draft's storage table is narrower than the code** (draft only).
    It omits `local`'s loop, suspension and 65,536-byte rules, `copy`'s
    same-type rule, and the refusal of `addrOf` on a member of a `const`
    view.

### Between pages, or inside the records

12. **`native-operations.md` decides the header reader twice, both ways.**
    "Deriving a binding from a header" chooses the clang subprocess. "Reading
    headers: the measurement, and what it decided" ends "**libclang, then**".
    The code uses the subprocess (`bind.rs:3-7`). The draft points readers to
    this notebook as "the design's history".
13. **`native-interop.md` carries superseded material with no banner.** It
    still lists "What happens when a callback throws?" as open (now decided),
    says "a C callback cannot capture" (`Closure<F>` exists), and uses
    `CFn`/`Ref`/`CStr`/`Owned` as if current. Only the scalars carry a
    "moved on" banner. The draft cites it as "the design's history".
14. **The owner-thread rule contradicts the code.** Record 0018 deletes
    `is_owner_thread`, but the code answers true with no host installed
    (`open-questions.md` contradiction 8; `nts_runtime.c:11766-11769`). The
    "callbacks are carried to the owner thread" rule (log `:581`) is built
    for Objective-C blocks and COM delegates, not for plain C or GLib.

---

## Unsound spots: facts trusted without being checked

Each item is a place where the compiler believes a binding's claim and
nothing verifies it. Items marked *inferred* were found by reading code and
not confirmed by running anything.

1. **`@ntsNoEscape`** is trusted (`native_storage.rs:4`: "Foreign no-escape
   annotations are trusted contracts"). It alone licenses passing `local`
   storage and lending `CBytes`, `CStrings` and `CHandles`. `bind-gir` infers
   it for every GIR out parameter.
2. **`string`, `Utf16String` and `StringView` parameters are implicitly not
   retained.** They need no tag, and ASCII and two-byte strings are lent *in
   place*. A callee that keeps the pointer, such as `putenv`, reads memory
   after the string is freed or moved, and nothing detects the binding error
   (`native.rs:412-420`).
3. **Non-null handle and pointer results are unchecked** (§10), and bind-c
   generates all of its pointer results non-null.
4. **Ownership claims are trusted.** `Owned` and `Consumed` come from GIR
   transfer or the selector family; a wrong claim double-unrefs or leaks.
   `@ntsFree` is trusted too, and the witness's `char *` against
   `const char *` test is weak evidence: `strerror` and `getenv` return
   `char *` and must not be freed.
5. **Callback lifetimes are trusted.** `ScopedClosure` assumes C calls only
   during the call. `OnceClosure` assumes exactly one call; two would use
   freed memory and none leaks. `Closure` assumes the notify runs exactly
   once. `ErasedClosure`'s signature is "the binding's claim", and `GCallback`
   hides it from the witness (`libc.d.ts:52-61`).
6. **Callback handle downcasts are trusted.** `bridges.rs:132-141` is a
   trusted downcast: "Trusted, not tested". It applies to every family, not
   only the DOM case that motivated it.
7. **`Declared<T, D>` results** are "a trust boundary, not a check"
   (`libc.d.ts:156`). **`unsafeDowncast`'s `is`** is trusted (`libc.d.ts:782`).
8. **`@ntsConstant` makes integers into dereferenceable pointers.**
   `RESOURCE: Ptr<Uint16> = 32512` can be indexed (`lower.rs:9077-9105`).
9. **Raw native memory is unchecked**: bounds, alignment, lifetime, `free`
   of a non-`malloc` or interior pointer, and use after free (§3, §4).
10. **The witness has gaps** (§13): modules with no `@ntsHeader` (as in
    `c-from-ts`), Objective-C sends, COM vtable slots (`@ntsVtable` slot
    numbers come from metadata), managed-ABI host bridges, and bit-field
    positions. On bit-fields the C backend defers to the header, while LLVM
    shifts and masks by its own layout, so a wrong width is invisible to the
    C lane and tested only by running.
11. **`Counted` lengths are always element counts** (`lower.rs:74034-74044`).
    An API that wants bytes beside a non-byte array would silently read past
    the end; the header cannot say.
12. **Managed objects from C are trusted to be what the type says.** A
    foreign function returning `Closure<F>` must hand back a pointer the
    program lent (`native.rs:3885-3899`). One returning `Promise<T>` must
    return a real `NtsPromise *`. `@ntsAbi managed` bridges "do not prove
    absence of mutation or retention" (`runtime/native/README.md`).
13. **The `@ntsThrows` converter is trusted.** Its prototype `char *f(E *)`
    and its `malloc`'d result are assumed, and it is declared with
    `declared_at: None`, so it is never witnessed (`lower.rs:70195-70224`).
14. **The owner-thread check does nothing without a host.** Shared
    libraries, static libraries and Node addons accept calls from any thread
    unchecked (`nts_runtime.c:11766`).
15. **Inferred: `long long` bindings fail their own witness on Linux.**
    bind-c maps `long long` to `BigInt64` (`bind.rs:1314-1315`), which C
    spells `int64_t` (`native.rs:5650`), and `int64_t` is `long` on Linux.
    `__builtin_types_compatible_p` and `_Generic` treat `long` and
    `long long` as different types, so a generated binding of, say, `llabs`
    or a `long long` field should be refused by its own witness on Linux.
    This is the defect the decided `c_longlong` alias fixes (`c-headers.md:94-99`).
16. **Inferred: `static inline` functions may work on C and fail on LLVM.**
    bind-c binds any `FunctionDecl` without looking at `static` or `inline`
    (`bind.rs:1009-1062`). The C backend calls a witnessed function through
    the header's own declaration (`emit.rs:1510-1528`), so it works there.
    The LLVM module has no definition to link against.
17. **Inferred: bigint `@ntsConstant` values may lose precision.** A
    non-pointer constant is parsed as `f64` and folded as `ConstFloat`
    (`lower.rs:9111-9119`, `:84364-84392`). A constant past 2^53 on a bigint
    kind would round, and a hex constant on a scalar is refused.
18. **Minor: one fixture's tag looks misplaced.** In
    `tests/interop/native-callback/types/library.d.ts`, a JSDoc block with
    `@ntsNoEscape f` (written for `apply_twice`) sits above
    `type Handlers`, so `apply_twice` keeps `Unknown` retention. A tag on a
    non-function declaration appears to be ignored silently. That is an
    inference, not checked against the frontend.

---

## The draft section, in one place

These claims exist only in the uncommitted `docs/targets/native.md`:

- the "Native storage: `c:memory`" table, with the rules for `local`,
  `sizeof`, `addrOf`, `copy`, `stringFrom`, `bytesFrom`, `pointerBits` and
  `unsafeDowncast`. Its content is mostly the committed `libc.d.ts`
  comments, including the unbuilt `asGtkBox` helper claim (contradiction 2);
- the pointer to the `native-operations.md` notebook as "the design's
  history" (see contradiction 12);
- the ResourceFlow sentences: "a fact it does not have is unknown"; "its
  vocabulary belongs to bindings, not to the language's memory model"; and
  "binding whole headers follows it", with the `native-interop.md` notebook
  as its history (see contradiction 13).
