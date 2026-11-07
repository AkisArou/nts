# Scalar numbers for nts: the design

Status: experiment, v19 (fourteen independent audits, a construct-coverage audit,
a real-programs audit and a concept survey of Rust, Zig, Swift, Kotlin, .NET,
Go and Ada). Nothing here is in the nts repository yet. Every decision behind it
is in `DECISIONS.md` (U01-U63), cited below as (Uxx).

**Since 2026-10-08 the direction is "Where this goes in nts", the next
section.** The proofs move into nts's compiler, calls are strict (U62), and the
patched checker is frozen as the reference. The sections after it describe
the rules as the frozen checker implements them; where they say a plain number
is "checked at the call", read "refused unless proven" (U62).

| Where | What |
|---|---|
| `scalars/` | **the tour, and the source of truth.** `scalars.d.ts` is the library. Cases 1-2 and `checks.ts` hold for every backend. `c/`, `jvm/`, `wasm/`, `windows/`, `macos/`, `ios/` and `gtk/` each have a binding and cases 3 (a JavaScript developer calls the platform), 4 (an app that keeps the kinds) and 5 (the platform calls TypeScript). The patched tsgo reports nothing; stock `tsc` reports only the tour's own claims |
| `runtime/` | `runtime.js`, the reference implementation of `nts:scalars` that node runs, and its oracle |
| `tests/abi-tables.py` | checks every C type table in `scalars.d.ts` against clang and zig on all 17 targets |
| `tsgo/` branch `scalars-v2` | the checker patch: `internal/checker/nts_scalars_algebra.go` (the rules), `nts_scalars.go` (types), hooks in `checker.go`, `relater.go`, `flow.go`, `jsx.go`, `nodebuilderimpl.go` and the binder, messages in `internal/diagnostics/nts_messages.go` |
| `DECISIONS.md` | every decision and commitment, with its status |
| `AUDIT-2026-10-08.md` | the October 8 audit: what was missed, and why |
| `JVM-UNSIGNED-BUG.md` | a latent defect in nts's JVM backend that scalars would expose |
| `test.sh` | every test, one command: `./test.sh` (or `./test.sh quick`) |

## Where this goes in nts (2026-10-08)

This section is the plan for adopting scalars into nts. The user is taking it
to nts's compiler owner (U63). The questions to settle on the way are in
`QUESTIONS.md`.

### Two questions, one engine

ScriptC, another TypeScript-to-native compiler, keeps two questions apart:
- **Safety:** can this number cross into a native integer without losing
  information?
- **Optimization:** can this computation use integer instructions or storage
  without changing what it computes?

Its developers never write a scalar type. Its FFI is a JSON manifest and a
hand-written `.d.ts` that says only `number`.

nts already answers the second question, further than ScriptC does, in
`compiler/core/src/hir/`:
- **`facts.rs`** is the same kind of analysis as ScriptC's `number-facts.ts`:
  flow-sensitive ranges, wholeness, NaN and -0, with JavaScript's own transfer
  functions. Its header says it learned from that code.
- **`specialize.rs`** makes every value it can prove is an integer into an
  `i32`/`i64`, per class of connected values. That is program-wide integer
  specialization, which ScriptC does not do.
- **`loops.rs`** bounds loop accumulators by trip count. Its header measures
  4.4x on a dependent chain and about 1000x on a plain sum.
- **`bounds.rs`** removes the bounds checks it proves, and **`zero_sign.rs`**
  finds where a -0 can be observed.

nts is also ahead on bindings. They are generated from the platform's headers,
so every parameter's real C type is known, and that is what lets a call be
proven without the developer writing anything.

**nts is behind on the first question.** A `number` passed to a C integer is
converted with ToInt32 (C05): `set_size(w / 3, 480)` is truncated and `2**31`
wraps. That is the gap to close first.

**So there is one engine, `facts.rs`, with three clients:**

| Who | Writes | Gets |
|---|---|---|
| A JavaScript developer | `number`, `bigint` | every call into C, Java or wasm proven safe (U62), and integer speed automatically |
| Everyone | nothing | integer specialization, bounded loops, removed bounds checks |
| A runtime author (nts's own runtime in TypeScript) | `Uint8`, `Int32` … where the width matters | real widths in memory and in fields, proven stores, `wrap`/`clamp` where asked |

The patched checker was a second engine: range proofs at the type level,
beside the compiler's. Two derivations of one fact drift apart, so the
checker's proofs don't move into nts. Its rules do.

### 1. Calls are strict (U62)

Every number passed to a call into C, Java or wasm must be **proven** by
`facts.rs` to fit the parameter's type on every target the build compiles
for:
- **Proven:** the value passes as it is, at no cost.
- **Disproven** (`crc16(buf, 70000)`): a compile error.
- **Unproven** (`send(Number(text))`): also a compile error. nts inserts no
  range check at a call.

The error says what the program can write instead:
- a guard that proves it: `if (n >= 0 && n <= 0xffff) crc16(buf, n)`;
- a clamp: `Math.min(100, Math.max(0, n))`, after `Math.round` if `n` may be a
  fraction;
- a mask: `n & 0xffff`;
- an explicit conversion, the one run-time check the program writes itself:
  `n as Uint16` throws a RangeError, and `Uint16.clamp(n)` saturates (U31,
  U49).

Floats aren't range-checked: a double passed to a `float` rounds (U55). A
bigint parameter takes a bigint; a number there is a type error.

**The cost:** existing nts programs that pass unproven numbers to GTK,
Objective-C or Win32 stop compiling until they guard or convert (C05). Several
tour lines that today read "checked at the call" become errors:
- `crc16(buf, buf.length)` in `c/3-calling-c.ts` (a length may pass 65535);
- `set_volume(Math.min(100, userValue))` (it may be negative or a fraction);
- `resize(img, userWidth, …)` in `wasm/3-calling-wasm.ts`;
- `set_size(width * 2, height)` in `c/4-c-and-scalars.ts` (`2 * int` may pass
  2^31).

**Strict is only livable if refusals are rare,** so `facts.rs` must know what
real calls pass:
- lengths: whole, 0..2^32-1;
- typed-array element reads;
- `charCodeAt` (0..65535) and `indexOf` (-1..2^32-2);
- `Math.trunc`/`floor`/`round`/`min`/`max`/`abs`;
- `| 0`, `>>> 0`, and `&` with a mask;
- guards through `if`/`while`, `&&` and an early return;
- loop counters bounded by a length (`loops.rs`);
- a binding's own return types: a `c_int` result is a whole number in `int`'s
  range.

The instrument is the refusal count on nts's GTK, Objective-C and Win32
examples, and on the tour's case-3 files. Each refusal there is either a real
bug (the old sweep found two: `gtk-journal`'s `get_n_items() - 1` and
`list-model`'s `remove(row.get_index())`) or a fact `facts.rs` lacks.

### 2. Written scalar types are facts and obligations

A written scalar type is an input to the same engine, not a second one:
- **A fact:** a `Uint8` field reads as a whole number in 0..255, and a binding's
  `c_long` return as `long`'s range on every target (the tables in
  `scalars.d.ts`, U57).
- **An obligation:** a store into a written slot must be proven, or else checked
  at run time as the frozen checker's rule says. C42 proposes making slots
  strict too; see below.
- **A representation:** `specialize.rs` gets real widths for storage. A
  `Uint8[]` field is bytes, not doubles, and a `Uint32` hash state is a 32-bit
  register. This is the performance half (U26), and what writing nts's runtime
  in TypeScript needs.

**Open (C42): should written slots be strict too?** Claude recommends yes, for
one rule everywhere: nts inserts no check the program didn't write. One case
has to be settled first. A store through a view that loses the width (an
`Int8[]` passed as `number[]`, U53) can't be proven where it happens, so either
that view is refused or such stores keep a run-time check.

### 3. The frozen checker, and what carries over

The patched tsgo (`tsgo/` branch `scalars-v2`, v19.2) gets no new features. It
stays the reference: `./test.sh` still passes, and its kind algebra
(`nts_scalars_algebra.go`) is an oracle for the compiler's.

These carry over into nts:
- the rules in this document;
- the decisions in `DECISIONS.md`;
- `runtime/runtime.js`, the conversions as node runs them;
- the per-target C tables, checked against clang and zig on 17 targets
  (`tests/abi-tables.py`). They replace nts's two-model `NativeAbi` and
  `needs_exact_integer`'s fixed LP64.
- the tour, as test programs with their claims;
- `JVM-UNSIGNED-BUG.md`: unsigned comparisons need unsigned instructions once
  unsigned widths are common.

**Only the fork gives editor-time errors and hovers.** nts reports the same
errors at build time. Whether in-editor feedback is worth a tsgo fork is
decided later, once nts reports them. nts could instead publish its build
diagnostics to the editor.

### 4. A smaller `nts:scalars` (proposed, not decided)

Nothing in `nts:scalars` is outside TypeScript:
- the types are a `.d.ts`;
- the functions have a real implementation (`runtime.js`), which nts compiles
  to instructions.

One fix is needed for node: it refuses the `nts:` scheme
(`ERR_UNSUPPORTED_ESM_URL_SCHEME`). The functions should be a package node
resolves (`@nts/scalars`), so a program that uses them runs under node
unchanged (QUESTIONS D1).

It is, though, more surface than any program has needed yet, and some of it
was Claude's addition (the bit functions, C28; `Float80`, C36). JavaScript
already has many of the operations: `Math.fround`, `Math.imul`, `Math.clz32`,
`BigInt.asIntN/asUintN(64, x)`, `& 0xff` and typed arrays.

The proposal:
- start nts's runtime-in-TypeScript work with the types, `as`, `wrap` and
  `clamp`;
- add only what that code asks for.

This would revisit U32 and U48 (`wrap`, `clamp`, `try` and `is` on every
scalar), so it waits for the user.

### Order

1. **Strict calls** with `facts.rs` (U62). This is the safety gap, invisible
   to programs that are already right. It needs every binding parameter's C
   type, with the per-target tables.
2. **Written scalar types** as facts, obligations and storage widths.
3. **The library surface,** grown alongside the runtime-in-TypeScript work.

Start reading nts at `compiler/core/src/hir/facts.rs`, `specialize.rs`,
`loops.rs` and `bounds.rs`, and at `native.rs` (`Scalar`, `NativeAbi`,
`needs_exact_integer`).

## In one page

A **scalar** is a `number` (or `bigint`) with an optional label naming its
**kind**: `Uint8`, `Int32`, `Float32`, `BigInt64`, `c_long`. Labels are optional,
so a plain number goes anywhere a scalar does, and a scalar goes anywhere a
number does. Nothing is forced on anyone:

1. **Plain JavaScript** never meets a scalar. It is TypeScript, and nts computes
   what node computes.
2. **An app that writes scalar types** gets them checked. `const b: Uint8 = i32`
   is an error; `u8 + u8` is typed by what it holds (`Int16 & Uint16`, 0..510);
   `Uint8.clamp(x)`, `Uint8.wrap(x)` and `x as Uint8` say what to do with a value
   that may not fit.
3. **A JavaScript developer calling a native library** passes plain numbers.
   Each must be proven to fit (U62): a value nts can't prove is a compile
   error, which a guard, a clamp or an explicit `as` resolves. C never
   silently receives a different value. (The frozen checker and the tour still
   show the earlier rule: a RangeError at the call.) Results carry the C kind; they are numbers, sizes included
   (`AsNumber`), except 64-bit values where every bit matters (hashes, ids,
   nanoseconds), which are bigints. A literal that can't fit is a compile error.
4. **An app that keeps the kinds a library gives it** gets the same checks as
   case 2, with the platform's own types (`c_int`, `CGFloat`, `LPARAM`).
5. **Native code calling TypeScript** sees the exports' written types as its
   signatures (C's, or Java's on the JVM). A throw that would cross C frames or
   a wasm component's aborts, naming the slot; on the JVM it reaches the caller
   as an exception.

Where a value may not fit, nts refuses it at compile time. At a call it must
be proven (U62); at a written slot, the frozen checker's rule checks it where
it lands (whether slots are strict too is C42). It never changes it silently,
with two deliberate exceptions: a float slot rounds, as a `Float32Array` does,
and -0 in an integer slot becomes 0.

## The library (`scalars/scalars.d.ts`)

### Recognition is nominal
A scalar is a type the library declares: a file whose leading comments say
`/// <nts-scalars />`. A program's own lookalike (`number & { __Int8?: true }`)
is a plain number. Recognising scalars by shape broke in eight audits, each
with a new corner (a generic's constraint, mapped keys, inherited members); the
library's declarations have none, and nothing a program declares is resolved to
decide. A program's own brand on top of a scalar
(`type UserId = Int32 & { __brand: "UserId" }`) is kept by searches and dropped
by arithmetic: `id + 1` is an `Int32`, not a `UserId`.

### Fixed widths
Every fixed width JavaScript, C, Rust and Zig name for interop (U36, U39):

| Kind | C | Rust | Zig | JVM | wasm | carried as |
|---|---|---|---|---|---|---|
| Int8, Uint8, Int16, Uint16, Int32, Uint32 | `int8_t` ... `uint32_t` | i8 ... u32 | i8 ... u32 | `int`; `byte[]`/`short[]`/`char[]`/`int[]` | `i32`; packed loads | number |
| BigInt64, BigUint64 | `int64_t`, `uint64_t` | i64, u64 | i64, u64 | `long` | `i64` (a BigInt in the JS API) | bigint |
| BigInt128, BigUint128 | `__int128` | i128, u128 | i128, u128 | two `long`s | two `i64` | bigint |
| Float16, Float32, Float64 | `_Float16`, `float`, `double` | f16, f32, f64 | f16, f32, f64 | `short` bits, `float`, `double` | `i32` bits, `f32`, `f64` | number |
| Float80, Float128 | x87 `long double`, `__float128` | --, f128 | f80, f128 | `double` | `f64` | number (a load from C rounds) |

`bigint` is also a kind: a bigint result no fixed width holds. `Big` stays in
the 64- and 128-bit names (U37): those kinds are bigints, never numbers.
`Scalar<K>` is the one generic (U38); a kind is named as its type is, and its
label is `__<Name>` (U40).

### C's own types are tables
A C type whose width depends on the target is declared with one row per target
naming the fixed width it is there (U57). `"*"` is every target not listed:

```ts
type c_long = CType<"c_long", { "*": "BigInt64"; "windows-x64-gnu": "Int32"; "wasm32": "Int32"; ... }>;
type CGFloat = CType<"CGFloat", { "*": "Float64"; "watchos-arm64_32": "Float32" }>;   // in a binding
type LPARAM = CType<"LPARAM", { "windows-x64-gnu": "BigInt64"; ... }>;                // no rows elsewhere: no such type
```

The library declares `c_char`, `c_int`, `c_uint`, `c_long`, `c_ulong`,
`c_long32`, `c_ulong32`, `c_longdouble`, `c_wchar_t`, `c_wint_t`, `c_size_t`
and `c_ptrdiff_t`. It also has aliases for the fixed ones (`c_short` is `Int16`,
`c_float` is `Float32`, `c_intptr_t` is `c_ptrdiff_t`). A binding declares its
own the same way: `NSInteger`, `CGFloat`, `CFIndex`, `GType`, `gsize`,
`LPARAM`, `off_t`, `time_t`. The set of target-dependent types is open, so no
fixed list can be complete.

A type is a bigint when any row is a 64- or 128-bit integer. `tests/abi-tables.py`
derives every row from clang's predefined macros, from `_Static_assert`s, and
from zig cc, on all 17 targets, and fails on any disagreement.

**Targets** are full triples, because the toolchain is part of the ABI:
Windows x64's `long double` is 80 bits under MinGW and 64 under MSVC (C11).

| | |
|---|---|
| Linux | linux-x64, linux-arm64, linux-armv7 |
| Android | android-arm64, android-armv7, android-x64 |
| Apple | macos-x64, macos-arm64, ios-arm64, ios-sim-arm64, ios-sim-x64, watchos-arm64_32 (ILP32) |
| Windows | windows-x64-gnu (nts's toolchain), windows-x64-msvc, windows-arm64 |
| WebAssembly | wasm32, wasm64 |

**C types apply only where C is called** (U41, U42). The JVM, and the wasm nts
builds itself (likely by hand, from its own IR), are not C targets: a program
there uses only the fixed widths, and calling C is refused by the backend, as
the JVM lane's NTS4001 does today. wasm32 is a C target only when the build
also compiles C to wasm32 (nts's C runtime, a C library linked in).

The library's marker names the C ABIs the build compiles C for:
`/// <nts-scalars targets="linux-x64 linux-arm64 macos-arm64 windows-x64-gnu" />`.
nts writes it from the build's config. Without the attribute, a library means
those four, and several libraries add up. An unknown name is reported at the
marker. So is a marker written any other way (`targets='...'`, `target=`), which
is still the library: a misspelling never turns the checks off silently.

### At a binding
- **`AsNumber<T>`** (U56): what a binding gives sizes, counts and indices
  (`AsNumber<c_size_t>`, `AsNumber<NSUInteger>`, `AsNumber<gsize>`), as Swift
  and GJS do. It is a plain number to the checker. It is exact up to 2^53, and a
  RangeError beyond that in either direction, never rounded. Bigints stay where
  every bit matters: hashes, ids, nanoseconds, `uint64_t`.
- **`CBool<K, True = 1>`** (U58): a `boolean` in the program, carried as kind K.
  Examples: `CBool<c_int>` for Win32's `BOOL` and `gboolean`,
  `CBool<Int16, -1>` for `VARIANT_BOOL`, and `CBool<Uint8>` for ObjC's `BOOL`
  (`CBool<Int8>` on x86-64 macOS). Any nonzero value reads as true. A function
  with three answers in one (`GetMessage`: -1 on error) is bound as its kind.
- **`CEnum<Members, K, "open" | "closed" | "flags">`** (U58):
  - open, the default: a value C returns may be one the binding never saw, so
    the program gets `Members | K`;
  - closed: an unknown value from C is a RangeError;
  - flags: any K goes in.

### Conversions (`import { Uint8 } from "nts:scalars"`)
Conversions are imported, never global (U32, U48, U49), so a program that does
not ask never meets them, and a script's own `const Int8` doesn't clash. Every
kind, the C types included, has these:

| | integer kinds | float kinds |
|---|---|---|
| `wrap(x)` | modulo 2^bits, as a typed array stores it (`Uint8.wrap(300)` is 44); a fraction is cut toward zero; NaN and ±Infinity are 0; takes a number or a bigint | -- |
| `round(x)` | -- | the nearest value (`Math.fround`, `Math.f16round`); from halfway past the largest, Infinity |
| `clamp(x)` | saturating; a fraction rounds half to even, NaN is 0 -- exactly a `Uint8ClampedArray` store | the nearest value, a finite one saturating at the largest finite |
| `try(x)` | the value, in T's carrier, if it is exactly one of T's, else `undefined` | likewise |
| `is(x)` | a type guard, carrier included | likewise |
| bits | `wrappingAdd/Sub/Mul` (exact modulo 2^bits, past 2^53 too), `leadingZeros`, `trailingZeros`, `countOnes`, `rotateLeft/Right`, `swapBytes`, `reverseBits`, `MIN`, `MAX`, `BITS` | `toBits`/`fromBits` for Float16, Float32 and Float64; `MAX`, `MIN_POSITIVE` |

A C type's functions use the width of the target the program runs on. In nts
they are to be compiler intrinsics (U33; adoption work). Under node they are `runtime/runtime.js`,
whose test checks 11.8 million cases against typed arrays, BigInt arithmetic
and an enumeration of every binary16 value. Float kinds have `round` in place
of `wrap` (a float has no modulus), and a float `clamp` keeps ±Infinity and NaN,
which are values of every float kind (C39, C41).

## The rule

**A slot never changes a value.** A slot is storage whose scalar type the
program **wrote**:

- a variable, a parameter, a class field, or the elements of an array, map or
  set whose type is written (`const xs: Uint8[]`, `new Set<Float32>()`);
- a return type, and `x as T` (U31).

Storing into a slot:
- **An integer slot** takes a value that fits, or throws a RangeError. A
  fraction, NaN and ±Infinity don't fit, and -0 becomes 0.
- **A float slot** rounds to its width, to ±Infinity past its range, and never
  throws (U55). This is what `Float32Array`, `Math.fround`, C, the JVM and wasm
  all do. Only a literal that would become Infinity is a compile error.
- **A value of the other carrier** is a TypeError (U54): `undefined`, a string,
  an object, or a bigint for a number kind.

A slot is the **storage**, not the static type at the store (U53). An array
whose type was written as `Int8[]` checks every store into it, also through a `number[]` view,
`any`, `Object.assign` or a generic write. Converting a reference converts nothing: an
array created as `number[]` and then viewed as `Uint8[]` keeps unchecked
elements, and what it yields is a claim, checked at the next slot. This is a
contract for nts's backends; the checker cannot see run-time views.

**A scalar is never unset** (U54). The checker refuses `level!: Uint8`,
`declare level: Uint8` and `let level!: Uint8`. A store that would leave holes in a scalar array is a
RangeError. Native storage therefore needs no presence bit.

**Inferred types are never slots.** Storage typed by inference holds what node
holds, and its type may be a claim, checked where it reaches a written slot. So
nts and node compute the same values until a written type is violated:
- `const idx = count - 1` holds -1 for an empty list, as in node;
- passing `idx` to a `guint` parameter is the RangeError.

A type parameter inferred from a call (`same<T>(f32, i32)`) rounds nothing. A
receiver's type argument counts as written only where the receiver's type was:
- `const ys: Float32[]`, `new Set<Float32>()` and a typed field are written, so
  `ys.push(i32)` rounds;
- `const xs = [f32]` was inferred, so `xs.push(i32)` is refused (write
  `Float32.round(i32)` or the type).

Explicit type arguments, `extends B<Float32>` and an instantiation expression
(`same<Float32>`) count as written.

**Typed arrays and DataView are JavaScript's**, not slots: a store wraps (or
rounds, or clamps for `Uint8ClampedArray`) and never throws, and an element read
is a plain number. Typing their reads would put scalars into programs that never
wrote one.

## What converts without a cast

A value converts into a kind when every value it may hold fits that kind **on
every target the build compiles C for**:
- `c_char` fits `Int16`, but neither `Int8` (unsigned on Linux arm64) nor `Uint8`;
- `c_long` fits `BigInt64`, but `BigInt64` doesn't fit `c_long` (32 bits on Windows).

The rest of the conversion rules:
- **A literal** is checked by its value: `const b: Uint8 = 300` is an error.
- **A plain number makes no claim**: into a written slot it is checked where it
  lands; into a call's parameter it must be proven (U62).
- **A scalar goes anywhere a number does.**
- **A float slot takes any number**, rounding it.
- **The type relation itself stays exact:** an `Int32` is no `Float32` in a
  guard, a conditional type or inference (`IsF32<Int32>` is false), so rounding
  is a slot's, never a type's.

**Overloads** are tried first exactly, with no slot rounding, and only then with
rounding (`sq(i32)` picks a `Float64` overload over a `Float32` one). Two rules
pick among exact fits:
- A plain number, or a literal with a fraction, tries an overload taking a
  `number` or a double first, then other floats, then the integer kinds.
- An integer literal or a scalar takes the first that fits.

So Java's `append(price)` is `append(double)`, `append(65)` is `append(int)`, and
`append(code)` with a `Uint16` is `append(char)`.

**Searching** compares rather than stores: `includes`, `indexOf`,
`lastIndexOf`, `has`, `get` and `delete` take any number, but keep the program's
own brands (an `OrderId` is no `UserId`).

## What operators infer

**A result is typed by what it holds** (U52):

| | | |
|---|---|---|
| `u8 + u8` | `Int16 & Uint16` | 0..510 |
| `255 - u8` | `Uint8` | |
| `u8 - 1` | `Int16` | |
| `i16 + 1` | `Int32` | |
| `i64 * 2n` | `BigInt128` | |
| `x & 0xff` | `Uint8` | |
| `x & 0x7f` | `Int8 & Uint8 & c_char` | |
| `i32 / 2` | `Float64` | |
| `f32 * f32` | `Float64` | JavaScript computes in doubles |
| `i32 + n` | `number` | a plain operand makes a plain result |
| `b++`, `b--` | `b`'s type | the old value (U17) |
| `i64 / 2n` | `BigInt64` | bigint division truncates, as BigInt does |

A type of several kinds holds values that are all of them at once, and is
printed as the intersection. A result is named only by kinds that hold it on
every target nts knows: the fixed widths, plus the library's C types whose
range differs by target (`c_char`, `c_wchar_t`, `c_wint_t`, `c_long`, `c_ulong`,
`c_size_t`, `c_ptrdiff_t`). So a declaration file means the same to every
consumer, and `i64 & 0xffffffffn` (`BigInt64 & c_ulong`) still goes into a
`c_ulong`.

**Past every kind** (32 bits for a number, 128 for a bigint), a result keeps its
operands' kind: `i32 + i32` is an `Int32`, `u32 - 1` a `Uint32`, `count - 1` on
a `guint` still a `guint`. This is a **claim**, checked where it is stored, and
it is the only way a type can say more than the value holds. Operands that
share no kind (`i32 + u32`) give a `Float64`.

**An operator reads its operands' exact ranges** from the expression, not just
their types: `u8 >> 3`'s type can say only 0..127, but the RGB565 packing
`((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)` is a `Uint16`.

**Lossy operands are errors** (U52). The checker refuses:
- an operand of a bitwise operator, `%`, `~` or `X.wrap` that may exceed 2^53:
  its low bits are gone before the operator sees them (`(h * 16777619) >>> 0`;
  use `Uint32.wrappingMul`);
- an operand of a bitwise operator that may need more than 32 bits, unless the
  wrap is written (`| 0`, `>>> 0`, `& mask`, `Int32.wrap(x)`). This catches the binary-search
  midpoint bug, `(lo + hi) >> 1`.

**`let` widens an operator's result** (U50): `let area = w * h; area = area / 2`
is a number, as `let x = 5` is. A call's declared return and a variable read
keep their kind (U30): `let crc = crc16(...)` is a `Uint16`, and
`crc = crc << 8` is refused. `const` keeps every kind.

**Compound assignment** stores into the variable's kind: `count -= 1` on a
`Uint32` throws at zero rather than wrapping. This applies to `+= -= *=` where
the step fits the variable's kind. A float slot rounds what it is given.

**`Math` knows kinds when given scalars** (U51), and only then:
- `Math.max(0, Math.min(255, i32))` is a `Uint8`, because a nested min or max
  passes its exact range up;
- `Math.abs(i8)` is a `Uint8` (0..128);
- `Math.floor(f32)` is a `Float32`;
- `Math.sqrt(i32)` is a `Float64`;
- `Math.round(w / 3)` is a plain number: an integer of no range a kind can
  claim, checked where it is stored.

Given plain numbers, every `Math` function answers `number`.

## Narrowing

- **A comparison narrows an integer scalar:** after `if (at >= 0)`, a
  `c_int` holds 0..2^31-1, so it goes where a `c_uint` does. Each branch gets
  the range the comparison proves, per target, against a literal or another
  scalar. Floats never narrow (NaN), and neither do plain numbers.
- **`===`, `==` and `switch` narrow to the literal**: after
  `case 10: setVolume(code)`, the code is 10.
- **Any assignment ends a comparison's narrowing** (`++`, `op=`, `=`,
  destructuring); a type guard's survives it.
- The flow walker steps over a comparison that doesn't mention the reference
  being narrowed, so a function of many comparisons on plain numbers reaches no
  control-flow limit.

## The other direction: exports and callbacks (U59)

A program's exports are its entry module's, and their written types are the
native signatures nts generates (`program.h`). Every parameter and return must
be written, because an inferred type is a claim, not a slot:
- a plain `number` is a `double`;
- a `boolean` is a `bool`;
- a plain `bigint` is refused (write `BigInt64`).

nts's build enforces this where it writes the signatures; the checker cannot
tell which module is the entry.

A callback a binding takes has its C type written in the binding
(`compare: (a: c_int, b: c_int) => c_int`). **A throw that would cross native
frames aborts the process**, naming the slot. This is what nts does today for
any throw in a callback, and what Rust does. The checker warns (TS99011) where a
callback a binding calls returns arithmetic that may not fit its kind, such as a
comparator's `a - b`: that is where an overflow becomes an abort.
`Math.sign(a - b)` or a clamp says what the answer is.

## Bindings spell the ABI of the library they bind

- **A C header compiled with the program** for each target uses `c_*` for C's
  own type names and the fixed widths for `<stdint.h>`'s (`c/libdemo.d.ts`).
- **A JVM class** has one ABI everywhere, and Java's primitives are fixed
  widths: `byte` Int8, `short` Int16, `char` Uint16, `int` Int32, `long`
  BigInt64, `float` Float32, `double` Float64. There are no `jvm_*` types (U43).
  - A declaration's annotations refine its type (from the SDK's
    `data/annotations.zip`): `@IntRange(from=0, to=255) int` is a `Uint8`, and
    `@ColorInt int` a `Uint32`.
  - Kotlin needs its metadata: a `UInt` parameter mangles the JVM name, and an
    `object`'s members live on `INSTANCE`.
- **A wasm module** was compiled once, for one ABI. A component is bound from
  its WIT; a C library compiled to wasm32 has its C types resolved to wasm32's
  widths. There are no `wasm_*` types.
  - Through the JS API an `i32` arrives signed, so a pointer past 2^31 needs
    `>>> 0` at the boundary.
- **Win32, AppKit, UIKit and GTK** use their own typedefs:
  - fixed ones by the fixed names (`DWORD` Uint32, `HRESULT` Int32, `unichar`
    Uint16, `guint32` Uint32);
  - target-dependent ones as tables (`LPARAM`, `NSInteger`, `CGFloat`, `gsize`,
    `GType`).
- **At the boundary nts checks first.** A Java `int` parameter given 2^31, or a
  wasm `u32` given -1, is a RangeError before the call. Today nts's JVM lane
  wraps (ToInt32), and the WebAssembly JS API wraps too.

## Diagnostics

nts's own diagnostics have codes 99001-99011 and registered templates, so an
incremental build reads them back. A refused store says what may not fit and
what to write:

```
Type 'Int32' is not assignable to type 'Uint8'.
  An Int32 (-2147483648..2147483647) may not fit a Uint8 (0..255). Say what should happen if it
  does not: `Uint8.clamp(x)` or `Uint8.wrap(x)` (from "nts:scalars"), or `x as Uint8` (a RangeError).
300 is not a Uint8 (0..255): `as` would throw a RangeError every time. Say what should happen:
  `Uint8.wrap(300)` is 44, `Uint8.clamp(300)` is 255 (from "nts:scalars").
0.1 is no Float32 value, so this comparison is always false in nts (the nearest Float32 is
  0.10000000149011612), though node may say true. Compare with `Float32.round(0.1)`.
```

## Backends

A kind is a set of values, not a machine word. Each backend keeps a value in
what it has (the table above), and owes the rule the same lowering:

- **The slot rule lowers the same way everywhere.** At an integer slot a range
  check precedes the conversion, because the JVM's `(int)` saturates and wasm's
  `i32.trunc_f64_s` traps, and neither is the RangeError nts promises. A float
  slot is the platform's own rounding from the double: `(float)`,
  `f32.demote_f64`.
- **Float16 rounds from the double directly**, never through f32: f64 to f32 to
  f16 rounds twice. On the JVM, `Float.float16ToFloat` is Java 20+ (Android API
  36); older Android needs `android.util.Half` or inline bit code. A chain of
  arithmetic is computed in doubles, as JavaScript does.
- **Unsigned kinds need unsigned operations:** comparisons, division, and u64 to
  double. The JVM lane has a known defect here (`JVM-UNSIGNED-BUG.md`).
- **FMA contraction must be off.** Generated C is compiled with
  `-ffp-contract=off`, and LLVM IR never sets `contract`. clang 14 and later
  contract `a*b+c` by default, and that is not JavaScript's arithmetic. nts is
  safe today only because emit-c gives every operation its own temporary.
- **C must never overflow a signed integer** (undefined behaviour) without a
  proof or `-fwrapv`. Rust, Zig, Go and Java define it; C does not.
- **Not every C type exists everywhere.** A backend refuses a binding that uses a
  type on a target where it doesn't exist, as `c_long32` is refused today:
  - `__int128` on armv7;
  - `_Float16` on wasm;
  - binary128 on Apple arm64, Windows arm64 and MSVC.

  The spelling differs too: `__float128`, or `long double`. The LLVM backend
  aligns i128 to 16.
- **Typed-array views are little-endian** on every backend, the JVM included,
  whose `ByteBuffer` defaults to big-endian. `DataView` is the portable spelling.
- **There is no unchecked build mode:** it would compute values node does not.

## How it is tested

`./test.sh` runs all of it:

1. **The oracle** (`nts_scalars_algebra_test.go`, about 7 minutes). It does not
   use the algebra's own derivations:
   - kind ranges come from Go's limits and from the library's tables, read from
     `scalars.d.ts`;
   - float exactness comes from real conversions, with binary16 via `big.Float`;
   - JavaScript's operators are reimplemented independently.

   It checks fits, conversions and literals on several target sets, and that
   results hold every value an operator produces. It checks that `+ - *` are
   exact whenever some kind holds the result, that result kinds convert to every
   kind that holds them, and that narrowing is sound and tight. It runs one
   target per distinct integer ABI.
2. **Named design cases**: every rule above, and the findings of every audit.
3. **Baselines** (`ntsScalars*.ts`, 48 programs): the type of every expression
   and every error, reviewed by hand, run three times.
4. **The C tables against the compilers** (`tests/abi-tables.py`): three
   derivations per row on 17 targets.
5. **The runtime** (`runtime/runtime.test.mjs`): 11.8 million checks, and 11
   deliberately broken copies, each of which must fail.
6. **Refusal pairs**: each refusal context is paired with TypeScript's own
   answer; a refusal TypeScript doesn't make fails.
7. **Determinism**: identical declarations and diagnostics under
   `--singleThreaded` and `--checkers 1/2/4/8`.
8. **The tour**: 0 errors patched. Under stock `tsc` only its claims fail, so no
   tour code needs the patched checker to compile.
9. **No change elsewhere**: tsgo's local tests and TypeScript's conformance
   suite pass unchanged.

## Known limitations

These are false claims or false errors the design accepts, listed so none is a
surprise:

- **Claims past every kind.** `i32 + i32` is typed `Int32`, but may hold 2^32
  until a slot checks it. The lossy-operand rule keeps bitwise operators from
  reading it as what it says. A comparison on it can be wrong about its range.
- **A narrowed reference stays narrowed across a call that changes it.** This
  holds for a property (`o.at >= 0`) and for a variable assigned inside a
  closure, and is inherited from TypeScript's own narrowing. The value is still
  checked where it lands.
- **Narrowing keeps only what a kind can say:**
  - `x !== -1` narrows nothing;
  - `v >= 0 && v <= 100` narrows to a `Uint8`, but `v <= 100 && v >= 0` doesn't
    (after `v <= 100` alone, -2^31..100 is still an `Int32`).
- **`(a % d)` with a divisor that may be 0** is typed as if it weren't. In nts
  the result is NaN, which a slot catches.
- **A callback's return, cached by an earlier overload, can decide a later
  one:**
  - with overloads `[<T>(a: T, cb: () => T); (a: Float32, cb: () => Float32)]`,
    `f(f32, () => i32)` is refused, though it is accepted when the written
    overload comes first;
  - a Float32 written inside a conditional or mapped parameter type counts as
    unwritten.
- **A closure returned by a generic call** keeps the outer call's inferred
  type: `curry(f32)(i32)` rounds into a `T` nothing wrote. Its result is a
  claim.
- **A float collection's search** (`fs.push(0.1); fs.includes(0.1)`) must round
  its argument as storing did. The checker can't see this; it is nts's backend
  contract. `f32 === 0.1` is reported.
- **Unknown target names** are reported when the library is checked, which
  `--skipLibCheck` skips.
- **A library written with the old keys** (`__c_int8`) is read only in part
  until `from_brand` reads both.
- **A scalar-keyed record** (`Record<Uint8, string>`) is refused, as TypeScript
  refuses `Record<number & {}, string>`. Write `Record<number, T>` or a `Map`.
- **`Scalar<"A" | "B">` means "both A and B"**: it is a result type, printed
  `A & B`. To say either, write `A | B`.
- **A literal several scalars hold widens to `number` first** (C25):
  `const a: (Int8 | Uint8)[] = [1, 300]` is accepted, and so is a literal
  through generic inference (`const p: Promise<Uint8> = Promise.resolve(300)`).
  Both are checked where they are stored.
- **Compound assignment on a union of scalars** isn't relaxed as it is on one
  kind: `let u: Uint8 | Int8 = 0; u += 1` is refused (an `Int16`).
- **Search through `.call`/`.apply`** (`ids.includes.call(ids, i32)`) is an
  ordinary call, so it is refused where `ids.includes(i32)` is accepted.
- **`satisfies` writes no slot**, so nothing rounds there:
  `{ s: i32 } satisfies { s: Float32 }` is refused, as an inferred type is.

## Costs

- **Node doesn't check.** A slot that would throw in nts holds the value in node
  (`runtime.js` makes the conversions identical, but not the slots).
- **A check per unproven store** at run time; nts's `facts.rs` removes the ones
  it proves.
- **A number not proven to fit an integer parameter is a compile error** (U62,
  C05). nts's C boundary converts with ToInt32 today, so existing GTK,
  Objective-C and Win32 programs that pass unproven numbers (`set_size(w / 3,
  480)`) stop compiling until they guard, round or convert.
- **Strictness:** `const s: Uint16 = a + b` needs `as Uint16` or a conversion,
  because `a + b` may need 17 bits (U52).
- **Stock TypeScript sees optional labels**, so to it every number kind is
  interchangeable:
  - it is less precise where scalars meet (`b++` is a `number`, and
    `const x: Uint8 = 300` compiles);
  - two patterns are wrong under it, not just looser: a guard `x is Float32`
    leaves `never` in a `Float64`'s other branch, and `T extends Float32` holds
    for integers.

  Both are right under nts's checker, which is what `nts build` uses, and the
  tour states them as claims.
- **Readability:** results print every kind that holds them
  (`Int8 & Uint8 & c_char`).
- **A fork to carry** through every tsgo upgrade.
- **Performance** (`PERF.md`): plain programs, with or without the library, check at unpatched speed (0.98-1.01x); scalar-heavy code at about 1.1x; a function of a thousand comparisons narrowing one scalar at 3.2x.

## Open

These are decided directions with work left, or questions not yet decided:

- **The performance half** (U26): written widths kept in storage and
  registers, through `specialize.rs` ("Where this goes in nts", step 2). Today
  nts lowers a label off the C boundary to `f64`; the backend table above is
  the contract, and inferred integers stay the backend's choice (only a written
  type pins a width).
- **C variadics** (`printf`, `g_object_set`, `objc_msgSend`'s `...`): C
  promotes each argument (a float to a double, a small integer to an int), so a
  binding must say each argument's C type, which a `...args: number[]` can't.
- **nts's own examples, re-swept.** At v13, a sweep of nts's GTK examples found
  two real errors: `gtk-journal`'s `get_n_items() - 1` (-1 for an empty list)
  and `list-model`'s `remove(row.get_index())` (an `int` that may be -1 into a
  `uint`). Under U52 the first keeps its kind, so it is now a RangeError at run
  time (`gtk/3-calling-gtk.ts`), not a compile error. The sweep has not been
  re-run since.

- **Ranges and sentinels:** `@IntRange` narrower than a width, `NonZero`, C
  bit-fields of N bits, and sentinels past 2^53 (`NSNotFound` is 2^63 - 1, so an
  `NSRange.location` stays a bigint). A binding could map a sentinel to `null`.
- **String-length units:** bytes (`strlen`), UTF-16 units (`NSString.length`),
  code points (`g_utf8_strlen`), and `wcslen` (UTF-32 or UTF-16 by target).
  Bindings should say which.
- **Packaging a library that uses scalars** (`@nts/scalars`: the types, and
  `runtime.js` for node): emitted `.d.ts` files need the library, and a bundled
  copy would duplicate every declaration.
- **The float environment:** foreign code can change rounding or flush
  subnormals; a debug build could assert the control word at callback entry.
  NaN payloads are promised only through `toBits`/`fromBits`, and node may
  canonicalize them.
- **The runtime half in nts:** the proofs at calls (U62), the slot rule
  (proven or checked, C42), float rounding at slots, the new kinds in nts's
  compiler, `nts:scalars` as intrinsics, the storage rule for arrays and
  fields, and the export signatures. The order is in "Where this goes in nts".
- **Adoption** (U63: the user is taking it to nts's compiler owner):
  - `libc.d.ts` becomes this library;
  - `CNumber` becomes `Scalar`;
  - `from_brand` reads `__<Name>` and the tables;
  - the build's targets go into the marker;
  - objc's `Int64`/`UInt64` become `bigint`.
