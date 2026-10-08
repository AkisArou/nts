# Scalar numbers in nts: the plan

**Status:** under discussion, 2026-10-08.
- **Decided:** D1-D8 (section 6). The plan is settled; next is step 0.

**Inputs:**
- the playground: `~/Projects/nts-playground` (`DESIGN.md`, `DECISIONS.md`,
  `QUESTIONS.md`);
- the ScriptC comparison;
- nts's compiler as it stands on main.

**The playground is an experiment, not the specification** (the user,
2026-10-08). Its rules and decisions are input. This plan refines them, and
where it finds a better answer it takes it and says why (D4 is the first such
case).

**The principle (the user, 2026-10-08):** target the best final architecture,
not what nts or the playground implements today. Section 4 is that
architecture, complete. Section 5 is only the order we build it in. Real usage
decides what comes first, never what's in scope.

---

## 1. What we want, in one paragraph

A JavaScript developer writes `number` and `bigint`, and nts must never hand a
native library a different value than the one the program computed. That's
**safety**. Where nts can prove a number is a whole number in range, it should
use the CPU's integer instructions and integer storage. That's **speed**. A
developer who cares about widths can also write them (`Uint8`, `Int32`, C's
`c_int`), and gets them checked and stored as written. That's **scalar types**.

ScriptC answers safety and speed with separate analyses. nts answers both, and
scalar types, with **one** analysis.

## 2. Where nts stands today

| Question | Today in nts | Gap |
|---|---|---|
| **Speed** | **Done, and further than ScriptC.** `facts.rs` proves ranges and wholeness. `specialize.rs` turns every provable integer into `i32`/`i64` across the whole program; ScriptC does this only for loop counters and a few patterns. `loops.rs` bounds loop counters, and `bounds.rs` removes array bounds checks it can prove. | Only what the analysis can't prove yet. |
| **Safety** at native calls | **Not done.** A `number` passed to a C `int` goes through JavaScript's ToInt32, as browsers do for WebIDL: `2**31` wraps to `-2147483648`, and `w / 3` is truncated, with no error. 64-bit C types take a `bigint`. | The main gap. |
| **Scalar types** in the program | **Not done.** nts reads only the C-boundary brands in `libc.d.ts` (`c_int` …). An `Int32` in ordinary code is just a `number`. | The playground's library and rules. |
| **Bigints** | No range analysis for bigints. | Needed to prove a `bigint` fits `int64_t`. |
| **Targets** | Two hard-coded ABI models; 64-bit `long` assumed (LP64). | Windows' 32-bit `long`, 32-bit platforms, wasm. |

## 3. What the playground settled

The playground patched TypeScript's checker so scalar types are checked while
you type. It produced:
- **the rules** (`DESIGN.md`);
- **about 60 decisions** (`DECISIONS.md`);
- **a complete type library** (`scalars/scalars.d.ts`);
- **a reference implementation of every function** (`runtime/runtime.js`,
  checked 11.8 million ways);
- **C type tables for 17 platforms**, checked against clang and zig;
- **a tour of five cases on seven platforms.**

It also showed a design mistake. The checker became a **second** range
analysis beside nts's own, and two analyses of one fact drift apart
(`DECISIONS.md` C43). So the checker is frozen as a reference and test oracle,
and the rest carries into nts.

## 4. The target architecture

Eight parts. Each is described as it should end up, not as it is today.

### A. One numeric engine

`facts.rs` is the only place nts works out what a number can be.

- **What it tracks:**
  - for a `number`: its range, whether it's whole, NaN, -0 (exists today);
  - for a `bigint`: its range (new);
  - for every value of a written type: the kind's range and width.
- **Where facts come from:**
  - operators and `Math`;
  - guards (`if`, `&&`, early returns, loops);
  - functions that **assert** (node's `validateInteger(n, "size", 0, 65535)`
    proves `n` is in 0..65535);
  - a binding's return types (a `c_int` result is in `int`'s range);
  - written types (a `Uint8` field reads as 0..255);
  - the conversions (`Uint8.wrap(x)` is 0..255);
  - **relations between values:** inside `if (a >= b)`, `a - b` is never
    negative. Today the engine tracks each value's own range, plus `i < length`
    for array bounds (`flow.rs`'s `less_than`). It needs `>=` and differences
    too, or `if (a >= b) { const d: Uint8 = a - b }` is refused although it's
    safe.
- **Who uses them:**
  - the checks (part D);
  - specialization and storage widths (part G);
  - bounds-check removal;
  - the error messages (part H).

**Why one engine:** every question about a number gets the same answer
everywhere. A second derivation is how the playground's checker and nts's
compiler would have drifted.

### B. One vocabulary: the type library

`scalars.d.ts` becomes nts's single description of numbers. It replaces
`libc.d.ts`'s `c_int`/`CNumber` brands.

- **Fixed widths:**
  - `Int8` … `Uint32` are numbers;
  - `BigInt64` … `BigUint128` are bigints;
  - `Float16` … `Float128`.
- **C's own types** (`c_int`, `c_long`, `c_size_t`, `c_wchar_t` …) are tables
  per platform (part C), not fixed sizes.
- **Booleans, enums and sizes:**
  - `CBool` is a `boolean` stored as an integer;
  - `CEnum` names the enum's values;
  - `AsNumber` is a size or count given as a number, exact up to 2^53.
- **Every binding generator emits it:** GTK's GIR, Objective-C, Win32, Java,
  wasm's WIT and C headers. One spelling for one meaning.

### C. Platforms are data

A per-platform table says how big each C type is and what it can hold: 17
triples today (`linux-x64`, `windows-x64-msvc`, `ios-arm64`, `wasm32` …).
- It replaces nts's hard-coded ABI models and the LP64 assumption.
- A proof must hold on **every** platform the build targets. A program built
  for Linux and Windows can't pass a value above 2^31 to a `c_long`.

### D. One rule at every boundary: proven or written

Wherever a number goes somewhere with a fixed width, nts must prove it fits.
That covers:
- an argument to C, Java or wasm;
- a store into a written scalar type (a variable, a field, an array element);
- a result returned to native code (an export, a callback).

Then:
- **Proven:** it passes as it is, at no cost.
- **Not proven:** a compile error. The program can:
  - guard it: `if (n >= 0 && n <= 0xffff)`;
  - limit it: `Math.min`, `Math.max`;
  - mask it: `n & 0xffff`;
  - **convert it explicitly**: `Uint16(n)` throws a `RangeError` if it
    doesn't fit (as `BigInt(1.5)` does), and `Uint16.clamp(n)` saturates.

**nts never inserts a check the program didn't write.**

**And `as` keeps TypeScript's meaning.** `n as Uint16` is an assertion with
no run-time effect, as everywhere in TypeScript, and node erases it. nts
*verifies* it: accepted where nts proves it, a compile error otherwise
(pointing to `Uint16(n)`, a guard or `clamp`). So `as` is never a hidden lie
and never a hidden check, and nts and node run the same line the same way.

Two deliberate exceptions, decided in the playground:
- a float slot rounds, as a `Float32Array` does;
- `-0` stored as an integer becomes `0`.

### E. Operators compute JavaScript's values

Writing `Uint8` changes what nts knows and checks, **never what an operator
computes**. `+ - * / %` give exactly node's answer and never wrap. The width
matters only where a result is *stored* into a fixed width (part D):

```ts
const a: Uint8 = 200, b: Uint8 = 100;
const sum = a + b;                 // 300, as node; nts knows 0..510, whole
const s16: Uint16 = a + b;         // proven: fits
const s8: Uint8 = a + b;           // compile error: 0..510 may not fit 0..255
const w: Uint8 = Uint8.wrappingAdd(a, b);   // 44, if wrapping is what's meant
if (a + b <= 255) { const g: Uint8 = a + b; }   // proven by the guard
```

- **`*`:** two large `Int32`s can multiply past 2^53, where a double rounds, so
  `Int32.clamp(x * y)` would saturate a wrong value. nts refuses it and names
  `Int32.saturatingMul`, `wrappingMul` (= `Math.imul`) or `checkedMul`.
- **`/`:** `7 / 2` is 3.5. An integer slot needs `Int32.div(a, b)` (3, toward
  zero) or `Math.trunc(a / b)`.
- **Bit operators** already have JavaScript widths: `v & 0xff` is 0..255,
  `v | 0` an `Int32`, `v >>> 0` a `Uint32`. Each fits its kind without a
  conversion.
- **`++`/`+=` on a typed `let`** is a store: `count++` on a `Uint8` that may
  be 255 is refused until guarded.
- **Speed:** a proven operation runs as an integer instruction. Plain `number`
  code gets this too, wherever it's provable (`specialize.rs`).
- **In the editor** (D7, until a language server exists), `a + b` shows
  `number`; the range appears in nts's build errors.

### F. The complete library of operations

Every function, on every kind it makes sense for. The playground designed all
of it:

| Group | Functions | Example |
|---|---|---|
| **Convert** | `Uint16(x)` (throws, like `BigInt(x)`), `try` (or `undefined`), `is` (a guard), `wrap` (keep the low bits), `clamp` (round and saturate) | `crc16(buf, Uint16(len))`, `bytes[i] = Uint8.wrap(v)` |
| **Integer operations** | five overflow modes (`wrapping`, `saturating`, `checked`, `strict`, `overflowing`) for `add`, `sub`, `mul`, `div`, `rem`, `neg`, `abs`, `pow`, `shl`, `shr`; plus Euclidean division, `absDiff`, `midpoint`, `isqrt`, `ilog2`, powers of two (D6) | `h = Uint32.wrappingMul(h ^ b, 16777619)` (FNV) |
| **Bits and bytes** | `leadingZeros`, `trailingZeros`, `countOnes`, `rotateLeft/Right`, `swapBytes`, `reverseBits`, `toBytes`/`fromBytes` | hashing, compression, codecs |
| **Floats** | `round`, `toBits`/`fromBits`, `mulAdd`, `copySign`, `nextUp`/`nextDown`, `totalCompare` (D6) | serialization, numerics |
| **Constants** | `MIN`, `MAX`, `BITS`; for floats, `MIN_POSITIVE`, `EPSILON` | `if (n > Uint16.MAX) …` |

How each function exists, once:
- **A compiler operation, not a function call.** `Uint8.wrap(x)` becomes one
  instruction, and the engine (A) knows its result is 0..255.
- **A real TypeScript implementation** (`runtime.js`) in a package node can
  load (`@nts/scalars`), so the same program runs under node.
- **An oracle test** keeps the two equal.

### G. Representation: real widths on every backend

The engine's facts and the written types decide what each value *is* in the
machine:
- a proven-integer `number` is an `i32`/`i64` register (exists);
- a `Uint8[]` field is bytes, and a `Uint32` is 4 bytes in memory;
- an `Int8[]` passed where a `number[]` is expected is refused (D2), since that
  view would lose the width;
- every backend gets real widths: C, LLVM, JVM and wasm.
  - The JVM needs its own care: it has no unsigned types, so unsigned
    comparison and conversion need the right instructions
    (`JVM-UNSIGNED-BUG.md`).
  - 128-bit integers and the wider floats get a representation per backend
    (playground `DESIGN.md` "Backends").

### H. Errors that teach, where the developer is

- **What an error says:**
  - what nts knows ("may be a fraction", "0..70000");
  - what the slot holds (`uint16_t`, 0..65535, on these platforms);
  - what to write instead.
- **Where it shows:** at build time, from the compiler (D7). A language
  server comes later.

## 5. Build order

The scope is all of section 4. This is only the sequence; each step lands
through the gate on its own.

**0. Measure.**
- An internal tool lists every native call where a number crosses into an
  integer, and whether the engine proves it. It's for us, not a user-facing
  warning mode.
- Run it over nts's examples, the node runtime, the Chromium lane and the
  playground tour.
- Classify every unproven call: a **real bug** (the old sweep found two,
  `gtk-journal`'s `get_n_items() - 1` and `list-model`'s
  `remove(row.get_index())`), or a **fact the engine lacks**.

**1. Strict native calls** (A, C, D):
- the facts step 0 found missing, including validators' assertions and written
  parameter types;
- the platform tables;
- the refusal turned on, landed together with fixes to the real bugs;
- bigint ranges.

**2. Written scalar types** (B, D, E, G):
- the library replaces `libc.d.ts`, and the binding generators move to it;
- written types become facts, obligations and storage widths;
- strict stores.

**3. The operations** (F):
- as compiler operations, with the node package and the oracle;
- **the convert group first.** nts's own runtime writes it by hand today:
  `& 0xff` 67 times, `| 0` 40, `>>> 0` 26;
- then arithmetic, bits and float bits.

**4. Backends and editor** (G, H):
- the remaining kinds on every backend (128-bit, `Float16`/`Float80`/`Float128`);
- the JVM's unsigned instructions;
- later, a language server (D7).

**Measured, not assumed:** ScriptC's "integer views" (an integer copy kept
beside a double, for values that are *sometimes* fractional). nts's per-class
specialization covers the common case. Measure once step 2 lands.

## 6. Decisions

### Decided (2026-10-08)

| # | Decision |
|---|---|
| D1 | **Strict from day one.** Step 0's internal tool gives us the list; no user-facing warning mode. |
| D2 | **Written slots are strict too.** One rule: nts adds no check the program didn't write. So passing an `Int8[]` where a `number[]` is expected is refused, though TypeScript allows it. |
| D3 | **The complete library is the target** (section 4F). Usage only orders the work. |
| D4 | **The explicit escape is `Uint16(x)`**, a real call that throws `RangeError` if the value doesn't fit (as `BigInt(1.5)` does). It behaves the same under nts and node, since node runs the polyfill. **`x as Uint16` keeps TypeScript's meaning** (erased, no run-time effect): nts accepts it only where it can prove it, and otherwise it's a compile error pointing to `Uint16(x)`. Revised 2026-10-08: the first answer, `as` throwing, would have made nts and node disagree, because TypeScript erases `as`. This supersedes the playground's U31. |
| D5 | **Safety first.** The build order above. |
| D6 | **Rust's complete integer API, designed as a TC39 proposal** (below), including `overflowing`. |
| D7 | **Errors at build time, from the compiler, for now.** A language server comes later, once the whole design is built correctly, with more features than errors (hovers showing what nts proved, for instance). No tsgo fork. |

### D6. Integer operations: Rust's complete family, designed as a TC39 proposal (decided)

**The question was:** only wrapping arithmetic, or every overflow mode, as
Rust has? For completeness, Rust's way is the most complete, and it fits
JavaScript better than it first looks. **Recommendation: adopt it in full**,
designed the way a TC39 proposal would be.

**The key observation.** Rust's overflow modes are exactly the conversion
group we already decided, applied to an operation instead of a value:

| Mode | The conversion (decided) | The operation (proposed) | `Uint8`, 200 + 100 | Rust |
|---|---|---|---|---|
| wrapping: keep the low bits | `Uint8.wrap(x)` | `Uint8.wrappingAdd(a, b)` | `44` | `wrapping_add` |
| saturating: stop at the edge | `Uint8.clamp(x)` | `Uint8.saturatingAdd(a, b)` | `255` | `saturating_add` |
| checked: nothing if it doesn't fit | `Uint8.try(x)` | `Uint8.checkedAdd(a, b)` | `undefined` | `checked_add` |
| strict: throw if it doesn't fit | `Uint8(x)` | `Uint8.strictAdd(a, b)` | throws `RangeError` | `strict_add` |
| overflowing: the result and whether it wrapped | (none) | `Uint8.overflowingAdd(a, b)` | `[44, true]` | `overflowing_add` |

So one vocabulary covers everything: a reader who knows `wrap` knows
`wrappingAdd`.

**The operations each mode applies to** (every integer kind, number or bigint):
`add`, `sub`, `mul`, `div`, `rem`, `neg`, `abs`, `pow`, `shl`, `shr`.
- `div` is **integer** division, cut toward zero (JavaScript's `/` gives a
  fraction, so integer kinds need it).
- Dividing by zero throws `RangeError` in every mode except `checked`, which
  answers `undefined`. This is JavaScript's own precedent: `1n / 0n` throws a
  `RangeError`.

**The rest of Rust's integer API** (no modes, every integer kind):

| Group | Functions |
|---|---|
| Division | `divEuclid`, `remEuclid` (the remainder is never negative), `divCeil`, `divFloor` |
| Arithmetic helpers | `absDiff`, `midpoint` (no overflow), `sign` |
| Roots and logarithms | `isqrt`, `ilog2`, `ilog10` |
| Powers of two | `isPowerOfTwo`, `nextPowerOfTwo` |
| Bits | `leadingZeros`, `trailingZeros`, `leadingOnes`, `trailingOnes`, `countOnes`, `countZeros`, `rotateLeft`, `rotateRight`, `swapBytes`, `reverseBits` |
| Bytes | `toBytes(x, "le" \| "be")`, `fromBytes(bytes, "le" \| "be")` |
| Constants | `MIN`, `MAX`, `BITS` |

**For floats** (every float kind), overflow is already defined by IEEE: it
becomes Infinity. So floats have no modes. Their completeness is:
- `round` (to the width), `clamp`, `try`, `is`;
- `toBits`, `fromBits`;
- `mulAdd` (fused multiply-add: one rounding, which JavaScript can't express
  today);
- `copySign`, `nextUp`, `nextDown`, `totalCompare` (an order that sorts NaN and
  -0 deterministically), `isSubnormal`;
- `MIN`, `MAX`, `MIN_POSITIVE`, `EPSILON`.

**The TC39 discipline,** which is how each function gets specified:
1. **Namespaces, not methods.** Functions live on a namespace object per
   kind, as `Math` and `Atomics` do (`Uint8.wrappingAdd(a, b)`), never on
   `Number.prototype`. Numbers are primitives, and extending built-in
   prototypes is off the table.
2. **Total.** Every function is specified for every input, including NaN, -0,
   Infinity, a fraction and a value outside the kind. An argument that isn't a
   value of the kind is a `RangeError`, as `Uint8(x)` says, never silently
   converted.
3. **Polyfillable.** Each one has a plain-JavaScript implementation
   (`runtime.js`, shipped as `@nts/scalars`), so a program runs unchanged
   under node. nts compiles the same function to an instruction.
4. **Consistent with what JavaScript already has**, and saying so:

   | Proposed | Existing built-in |
   |---|---|
   | `Int32.wrappingMul(a, b)` | `Math.imul(a, b)` |
   | `Uint32.leadingZeros(x)` | `Math.clz32(x)` |
   | `BigInt64.wrap(x)` | `BigInt.asIntN(64, x)` |
   | `Float32.round(x)` | `Math.fround(x)` |
   | `Float16.round(x)` | `Math.f16round(x)` |

5. **One name, one meaning,** across every kind and mode. `wrapping` always
   means modulo 2^bits, and `strict` always throws `RangeError`.
6. **Cost stated.** Only `overflowing` returns two things, as an array. nts
   compiles it without allocating; under node it is an allocation, which the
   docs say.

**Settled within D6:**
- the names are Rust's, camel-cased, as above;
- `overflowing` is in: it's what multi-word arithmetic (big-number libraries,
  cryptography) needs;
- `toBytes`/`fromBytes` are kept for completeness and symmetry with Rust, with
  `DataView` named as their equivalent.

### D8. The playground's 15 smaller rules (C27-C41): a guided review

These were calls Claude made in the playground without asking. The move
into the compiler (section 4) settles nine of them by itself. **Six are yours.**

**Settled by the architecture (no decision needed):**

| Call | What it was | Why it's settled now |
|---|---|---|
| C28 | The bit functions | Part of the complete library (D3, D6). |
| C36 | Library additions: `Float80`, `c_wint_t`, Windows' `-gnu`/`-msvc` platforms | Part of the complete library (D3). |
| C33 | How the checker ranked overloads for plain numbers | Concerned only the frozen checker. |
| C34 | Printing a result's type as `Int16 & Uint16` | Concerned only the frozen checker's hovers. |
| C38 | A library without a platform list | nts's build decides the platforms (part C). |
| C35 | The rule for exports is the build's, not the checker's | It is, since errors are the compiler's (D7). |
| C31 | `i % n` where `n` may be 0 keeps its kind | Now an engine fact: the result "may be NaN". A strict slot (D2) refuses it until the program guards `n !== 0`. |
| C32 | `Math.round(x)` of a double is a plain number | Now an engine fact: `Math.round(w / 3)` is whole, with `w`'s range divided by 3, so `set_size(Math.round(w / 3), 480)` proves where `w`'s range is known. |
| C40 | A callback whose arithmetic might not fit its integer return got a warning | A value returned to native code is a boundary (part D). It must be proven, so it's an error, not a warning. |

**The six that needed a decision.** All decided 2026-10-08:

| Call | The rule | Example | Recommendation |
|---|---|---|---|
| C27 | **Typed arrays keep JavaScript's behaviour.** A store wraps, and is not a strict slot. | `bytes[0] = 300` in a `Uint8Array` stores 44, as node does. | **Decided: keep.** Plain JavaScript uses typed arrays, and nts must compute what node computes. Their reads still give the engine facts (0..255). |
| C29 | **Conversions are imported, never global.** `import { Uint8 } from "@nts/scalars"`. | A global `Uint8` would clash with a program's own `const Uint8`, and wouldn't exist under node. | **Decided: imported only** (below). |
| C30 | **Inferred types are never slots.** Only types the program wrote are checked where stored. | `const idx = count - 1` holds -1 for an empty list, as in node. Passing `idx` to a `guint` is where it's refused. | **Decided: keep.** Otherwise plain JavaScript stops computing what node computes. |
| C37 | **Sentinels past 2^53.** Apple's `NSNotFound` is 2^63-1, which a number can't hold exactly, so `NSRange.location` is a `bigint`. | `range.location === NSNotFound` | **Decided (left to Claude): change.** The binding generator maps a known sentinel to `null`, so `location` is a number or `null`. It's natural for a JavaScript developer, and it's the final architecture. A sentinel the generator doesn't know stays exact (a `bigint`). |
| C39 | **Floats have `round`, not `wrap`.** | `Float32.round(0.1)` is the nearest float. A float has no modulus, so `wrap` means nothing. | **Decided: keep.** |
| C41 | **A float `clamp` keeps Infinity and NaN.** | `Float32.clamp(1e39)` is `Float32.MAX`, but `Float32.clamp(Infinity)` is Infinity, and NaN stays NaN. | **Decided: keep.** Infinity and NaN are values every float kind holds; `clamp` is about the finite range. |

#### C29 in detail: imported, or global?

The question is how a program gets `Uint8.clamp` and the other functions:

```ts
// (a) imported, as the playground has it
import { Uint8 } from "@nts/scalars";
const pixel: Uint8 = Uint8.clamp(r * 1.2);

// (b) global, as `Math` and `Temporal` are
const pixel: Uint8 = Uint8.clamp(r * 1.2);
```

Who meets this at all:
- **A JavaScript developer calling a native library** writes no scalar and
  imports nothing (cases 1 and 3). The bindings import the types themselves.
- Only **a program that writes scalar types** (case 2) needs the line.

**What TC39 would say.** Two things pull in opposite directions:
- **If it were part of the language, it would be global**, as `Math`,
  `Atomics` and `Temporal` are.
- **A library must not claim global names before the standard does.**
  TC39 has paid for this twice:
  - MooTools added `Array.prototype.flatten`, so the standard method had to be
    renamed `flat` ("smooshgate");
  - an old library's `Array.prototype.contains` made the standard one
    `includes`.

  A non-standard global `Int32` or `Uint8` would put the same burden on any
  future proposal that wants those names, and nts would then disagree with
  the language.

So a library that isn't standard yet ships as a module. It's designed as if
it were a proposal (D6), so it *could* become one, and if it ever were
standardized, the global would follow the standard. That's how
`@js-temporal/polyfill` works today: `import { Temporal } from
"@js-temporal/polyfill"`.

The other costs of (b):
- **node** would need a setup step before the program runs (`--import
  @nts/scalars/global`), or `Uint8` would be undefined there;
- **a script's own `const Uint8`** would collide with the global's
  declaration (playground audit B6).

**Options:**
- **(a) imported only.** One way to get it, and it works under node with
  nothing else.
- **(b) global only.**
- **(c) both:** imported by default, with an opt-in global entry
  (`import "@nts/scalars/global"`). That's two spellings of one thing.

**Decided: (a), imported only.** It's what a TC39-minded library does before
standardization, and it costs case-2 programs one import line.

## 7. How we'll know it works

- **The step-0 table**, re-run after every step: the refusal count must fall
  as facts are added, and every remaining refusal is classified.
- **The tour as fixtures:** each call in `scalars/` has an expected outcome
  (proven, or refused with a given fix).
- **The frozen checker as an oracle:** its exact arithmetic rules
  (`nts_scalars_algebra.go`) check the engine's on random expressions.
- **`runtime.js`'s oracle:** checks every compiled operation against the
  reference.
- **The gate**, as for everything: the full `pinned.sh` run, with
  `bench-agree` for the speed claims.

## 8. Glossary

| Word | Meaning |
|---|---|
| **Range analysis / the engine** (`facts.rs`) | The compiler working out, without running the program, what values something can hold: "a whole number between 0 and 100", "may be a fraction", "may be NaN". |
| **Specialization** (`specialize.rs`) | Using a 32- or 64-bit integer instead of a double for a value proven to be a whole number in range. Faster, same answer. |
| **Strict** | Where a number goes somewhere with a fixed width, it must be proven to fit, or the build fails. Nothing is checked at run time unless the program wrote it. |
| **ToInt32** | JavaScript's rule for turning any number into a 32-bit integer: drop the fraction, wrap around. `2**31` becomes `-2147483648`. Correct JavaScript, and silently wrong for a C function expecting a size. |
| **Platform / ABI** | How a platform lays out C types. `long` is 8 bytes on Linux and macOS, 4 on Windows. |
| **Binding** | The `.d.ts` file that describes a native library to TypeScript, generated from the library's own headers (GTK's GIR, Apple's headers, Win32 metadata). |
| **Slot** | Anywhere a value is stored with a written type: a variable, a field, an array element, a parameter. |
| **Compiler operation (intrinsic)** | A function the compiler understands and turns into an instruction, rather than calling it. |
