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

**No compatibility layer** (the user, 2026-10-08). The old forms are removed,
not kept beside the new:
- `libc.d.ts`'s brands (`c_int8` …, `CNumber`);
- the `ToInt32` conversion at native calls;
- the two hard-coded ABI models.

Every binding, binding generator, example, test and runtime file is
refactored in the same change that replaces what it uses. Nothing is
deprecated, aliased or kept "for now".

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
  - saturate it: `Uint16.clamp(n)` (`Math.min(…, Math.max(…))` is *not*
    enough: it lets NaN through, and `Math.round(NaN)` is NaN);
  - mask it: `n & 0xffff`;
  - **convert it explicitly**: `Uint16(n)` throws a `RangeError` if it
    doesn't fit (as `BigInt(1.5)` does), and `Uint16.clamp(n)` saturates.

**nts never inserts a check the program didn't write.**

**And `as` keeps TypeScript's meaning.** `n as Uint16` is an assertion with
no run-time effect, as everywhere in TypeScript, and node erases it. nts
*verifies* it: accepted where nts proves it, a compile error otherwise
(pointing to `Uint16(n)`, a guard or `clamp`). So `as` is never a hidden lie
and never a hidden check, and nts and node run the same line the same way.

The playground had two exceptions here: a float slot rounded, and `-0`
stored as an integer became `0`. **Q3 replaced both** (section 6b): a float
slot must be stored an exact value, and `-0` is ruled out wherever the
program could read it back -- so nts and node compute the same values with
no exception.

### E. Operators compute JavaScript's values

**One stated rule:** plain arithmetic is never refused for being inexact. It
computes node's value, exact or not. Only a value that reaches a conversion
or a fixed-width store is checked, and there a value that may have passed
2^53 (and so been rounded) is refused. That's the scope of the playground's
"lossy operand" rule (U52).

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
- **`/`:** `7 / 2` is 3.5. An integer slot needs `Int32.strictDiv(a, b)` (or
  another mode's `div`: 3, toward zero) or `Math.trunc(a / b)`.
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
| **Integer operations** | five overflow modes (`wrapping`, `saturating`, `checked`, `strict`, `overflowing`) for `add`, `sub`, `mul`, `div`, `rem`, `neg`, `abs`, `pow`, `shl`, `shr`; plus Euclidean division, `absDiff`, `midpoint`, `isqrt`, `ilog2`, powers of two (D6) | `h = Uint32.wrappingMul((h ^ b) >>> 0, 16777619)` (FNV; `^` gives a signed result, so `>>> 0` makes it a `Uint32`) |
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
- **The codes** (`hir::obligations::check`):
  - `NTS5001`: a value that may not fit what it is stored into, with why and
    how to prove it using what JavaScript already has (`Number.isInteger`, a
    guard on the range, `Math.fround`), so the fix runs the same under node;
  - `NTS5002`: a function let into a function type whose parameter is not
    written as the kind the function's own parameter is;
  - `NTS5003`: an override that writes a parameter or its result as another
    kind than the method it overrides.

  A program with any of them does not compile (`Unprepared::Rejected`), as one
  that does not typecheck does not.

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

**Step 0 results (2026-10-08).** `nts facts --crossings`, over 648 projects
(every example, `runtime/node`, the Chromium lane), judged by local facts only
(Q2). Counted once per source location:

- **275 proven, 589 unproven.** The whole-program analysis would prove just
  6 more (281 / 583), so Q2 costs almost nothing.
- 22 projects couldn't be measured alone: the `examples/workspace` apps need a
  workspace build, `examples/invalid` fails to typecheck on purpose, and two
  GJS examples don't typecheck in isolation.

What the 589 unproven are, and what clears each group:

| Group | Count | Example | Cleared by |
|---|---|---|---|
| **Generated GTK wrappers' parameters** (`bind-gir`'s `*.values.ts`) | 452 | `default_port: CNumber<"uint16">` passed straight to C | **Written types as facts** (Q1). No program changes. |
| **A native function's result passed on** | 22 | `close(open(…))`; `remove(list, sel.get_selected())` | **A binding's return type as a fact** (a `guint` result is 0..2^32-1) |
| **Loop counters over native counts** | 8 | `for (i = 0; i < n; i++) get_object(model, i)`, `n` from `get_n_items()` | the same, plus the existing `i < n` relation |
| **Constructor properties** | 31 | `new Gtk.Box({ spacing: 6, … })` | **The bound property's type as a written type** |
| **Globals holding native values** | 16 | `weak_alive(tallyWatch)` (macOS) | written types and binding results |
| **Parameters of the program's own functions** | 34 | test entry points `export function f(n: number)` passing `n` to C; callback parameters (`DefWindowProcW`, GObject overrides) | callbacks: the binding's parameter types. Exports: **the example declares `n: c_int`**, and the test harness generates inputs that fit. |
| **Arithmetic that can really overflow** | 11 | `get_n_items() - 1` and `badge_number -= 1` send -1 (as 4294967295) when empty; `size + 300`, `width_chars += 3` can pass `int`'s range | **Real bugs or real edges: the program must guard.** Strict is right here. |
| **Values from outside** | 9 | `Number(args[0])` in the GJS workbench | **An explicit `c_int(…)` or a guard.** Strict is right here. |
| Other (a field, an element, a program call's result) | 6 | | individually |

**What the engine must learn** (from the census's own probes):
- guards through `&&`, an early return through `||`, and `Number.isInteger`:
  today only nested `if`s narrow;
- `Math.round`/`floor`/`trunc` give whole numbers;
- relations: `a - b` is non-negative inside `if (a >= b)`.

**So about 20 of the 589 are refusals strict exists for:** two real
underflows, several possible overflows, and values from outside. Everything
else clears by making written and binding types facts, which step 1 does
first.

**1. Strict native calls** (A, C, D):
- the facts step 0 found missing, including validators' assertions and written
  parameter types;
- the platform tables;
- the refusal turned on, and the `ToInt32` conversion at native calls
  (`integer_argument`) deleted, in the same change as the fixes to the real
  bugs and every example that relied on it;
- bigint ranges.

**Step 1 design (2026-10-08).** Facts and obligations arrive together: a
written type may be trusted (Q1) only once every store into it is checked
(D2). Otherwise integer specialization would trust a `c_int` parameter that a
caller filled with `3.7`.

- **Written kinds live on the slots.** Each slot records its written scalar
  kind, if it has one: a parameter (`Param::written`, separate from
  `Param::known`, which the optimizer fills with whole-program facts), a
  field, a global, a function's return, a native function's parameters and
  result. One function recognises a kind from a type. Today that's the
  `c_*` brands; step 2 switches it to the new vocabulary.
- **Two readers of the same record:**
  - **the obligation check:** every store into a slot with a written kind must
    be proven, by local facts only (Q2). Stores are a call's argument against
    the callee's parameter, a field store, a global store, a return, and a
    native argument or native store;
  - **the range analysis:** a read from such a slot is the kind's range and
    whole.
- **What has no slot:** a local variable's assignment (`let x: Uint8`, an SSA
  value) and an `x as Uint16` claim (D4). These are kept as a per-function
  obligation list made by the lowering.
- **No new HIR operation.** The written types are already the slots' types,
  and nothing changes at run time.

The sub-steps, landed together through the gate when strict is on:

| | Sub-step |
|---|---|
| 1a | One recognizer for a type's scalar kind; a kind's range (64-bit `long` everywhere until 1h) |
| 1b | Written kinds on the slots, filled by the lowering |
| 1c | The obligation check, generalizing the census to every store above |
| 1d | Facts at reads of written slots and native results |
| 1e | The engine's missing facts: `&&`, `\|\|` and early-return guards, `Number.isInteger`, `Math.round/floor/trunc/ceil` |
| 1f | Closing TypeScript's holes (Q1): width-changing conversions refused |
| 1g | Strict on: the refusal as an error that teaches; `integer_argument`'s `ToInt32` deleted; every example and binding generator fixed; the test harness generating inputs that fit |
| 1h | Platform tables (replacing the two ABI models); bigint ranges |

**Step 1 as built (in progress, branch `claude/scalar-step1`).** What the
design above became in the code, and the choices made on the way:

- **Obligations come from two places, never one derived twice.** Where the
  HIR has a slot, the obligation is read off the store's operation: a call
  names its callee (`Param::written`), a native call its C parameter types, a
  field store its field (`Field::written`), a global store its global
  (`Global::written`), a `return` its function (`Func::written_return`) -- and,
  in a function C calls back, the callback type's C result -- and a store
  through a native pointer its pointee, a bit-field its width. Where the HIR
  has none, the lowering records it (`Func::obligations`): a local written as
  a kind (at its declaration and every assignment), an `as`, and an argument
  to a call through a function type (whose callee is any function of the
  type, so the type's kinds are the obligation). `hir::obligations` walks both.
- **"Written" means an annotation** (S3), or a parameter with neither
  annotation nor default, whose type its context declares -- a binding's
  callback, a declared function type. A field or local inferred from its
  initializer has no kind, whatever the initializer was.
- **The analysis reads the same kinds** (`flow::Written`): a written
  parameter, a native result, and every read of a written field, global or
  return is the kind's range. It is declared rather than inferred, so the
  whole-program fixpoint and the strict check share it; only the latter is
  limited to it (Q2).
- **A value that may not be a number is unproven** (an `any`, an erased
  union): Q1 makes it a store like any other.
- **`-0` only where the program reads it back.** Q3's reason is parity: nts
  must not compute a different value than node. A program slot (a written
  parameter, field, global, return, local, or argument through a function
  type) may be held at an integer width, which would read `-0` back as `0`,
  so there it is an obligation. A native argument, a native store and a
  callback's result leave the program -- C, Java and wasm can't tell `-0`
  from `0` and receive the same integer -- and an `as` stores nothing. There
  it is not.
- **1e, the engine:** an `if` condition built from `&&`, `||` and `!` that
  assigns nothing is lowered as jumps, so each test narrows like a nested
  `if`; `Number.isInteger(x)` taken makes `x` whole and not NaN; and a fact's
  `whole` now means "every finite member is an integer", so `Math.round(x)`
  keeps it through a possible `Infinity` and a later guard completes it
  (`Facts::integral` is the old meaning). Facts flow through an `Unerase`,
  emitted only where a test proved the value is a number, which a uniform
  closure entry needs to pass its written parameters on.
- **Bigints have exact ranges of their own** (1h): a double can't tell
  `2^63 - 1` from `2^63`, the very edge `BigInt.asIntN(64, x)` sits on, so the
  strict check runs a small local analysis of exact 128-bit intervals over
  them: written kinds, native results, literals, `asIntN`/`asUintN`, `+ - * &
  >>` and negation, joins, and comparison guards.
- **A `float` slot takes a value proven exact**, judged from how it was made:
  `Math.fround(x)` (JavaScript's own narrowing, so node runs it too), a value
  that was a `float` already, a number a `float` holds exactly, or a join of
  those.
- **Targets** (`Options::targets`, default the host): an obligation's kind is
  the one every target holds (`Scalar::on`), so `long` is 32 bits for a build
  that includes Windows. This is today's two ABI models; **the platform
  tables move to step 2**, where they are keyed by the new vocabulary's names.
- **Strict is on, and the wrapping is gone**: `prepare` runs the check right
  after lowering, and a `number` into a C integer argument or store is
  converted exactly, being proven to fit. A typed array keeps `ToInt32` (C27).
- **More slots carry kinds** than the first list:
  - an `async` function's written payload (`Promise<c_long>`): each `return`
    settling it is obliged, and an `await` of a call to it reads the range;
  - a tuple's elements, where the tuple is a record (mixed element types). A
    tuple literal passed to a tuple parameter is built as the parameter's
    tuple, so its elements are stores into it. A homogeneous tuple is an
    array, and arrays of written kinds are step 2's (S4);
  - a written local a closure captures, through its cell;
  - `number & { readonly __c_of?: T }` is `T`'s kind, which is how a mapped
    record (`Copied<T>`, `Fields<T>`) keeps each number field's C type.
- **A count a binding declares narrower than any array** (WinRT's `uint32_t`
  beside every array) is bounded before the call: an array too long for it
  throws a `RangeError`. The binding wrote that check by declaring the count
  (Q4), as with `AsNumber`.
- **More facts the examples needed:** a code unit read below its string's
  length is never NaN (the relation `bounds.rs` uses); `Math.sign` is -1, 0 or
  1; `Math.min`, `Math.max`, negation and `abs` of exact `float`s are exact,
  and so are `x ± 0`, `x * ±1` and `x / ±1`.
- **A root's written parameter is its kind at the boundary**
  (`written_roots`). Inside, `n: c_int` is the kind's range because every call
  in the program was obliged; a caller outside was not, and a `double` slot
  let it pass anything -- `3e10` reaching the body's conversion to `int` was
  undefined behaviour. So C's header says `double f(int32_t)` and C converts
  at its own call; the node addon reads a number into the slot only where it
  is one exactly and throws node's `ERR_OUT_OF_RANGE` `RangeError` otherwise
  (-0, a fraction, NaN, out of range); the body widens it exactly. Q4's rule:
  the declaration wrote the check. A method keeps its signature, which every
  implementation of its slot shares.
- **Tests that asserted the old conversions now assert the rule.** `add(2.9,
  …)` into an `int` truncated to 2; it is refused. A constant too wide for
  Win64's `long` is refused at its `as` when the build's targets include
  Win64, and `-1n as c_ulong` on every target.



**Step 1 results (2026-10-09).** The strict check itself (`nts facts
--strict`, the compile errors a build now stops on), over the same 648
projects, by a release build of the step-1 branch:

- **Correction (2026-10-09, after landing):** those 648 were 648 of the
  tree's 1,248 projects; the list had left out all of `runtime/react`. Over
  the other 602, the only strict errors are the five React native programs,
  253 distinct sites: react-gtk's generated prop setters pass erased props
  (an "any number") to C, plus handwritten ids, unbounded loop indices and
  timeouts. Each is program-side (none is a fact the engine lacks); the
  decisions went to the React lane, which puts the conversions in react-gtk's
  generator. Everything else, `runtime/node` whole included, is clean.
- **644 measured, 0 errors.** The last two were the Chromium lane's page
  script (`clearTimeout(state.pending)`, `clearInterval(<a number from an
  attribute>)`): WebIDL converts a timer id with ToInt32, so that lane's
  binding takes a `double` and converts it as Blink does, as `setTimeout`'s
  timeout already was (5b3dec787).
- The 4 not measured fail to typecheck on main too: `examples/invalid` on
  purpose, two GJS examples alone, and a workspace package whose platform
  modules a workspace build generates. The other workspace apps and
  `examples/library` are measured, with `@nts/config` linked as the gate links
  it.
- Step 0's 589 unproven crossings went three ways. Most were cleared by facts:
  written and binding types (the generated GTK wrappers' 452 among them),
  native results, `&&`/`||`/early-return guards, `Number.isInteger`, rounding,
  guarded string reads. The real edges were fixed where the program is: the
  two underflows step 0 named, a badge count below zero, sizes stepped past
  `int`, gettext's count, and values from outside guarded or converted in
  so many words (`>>> 0`, `| 0`, `Math.fround`). The rest were the program
  writing the kind it already meant (`let watch: c_int`, `Promise<Int>`).

**2. Written scalar types** (B, D, E, G):
- the library replaces `libc.d.ts`, which is deleted; the binding generators
  emit the new names, every checked-in binding is regenerated, and every
  example and runtime file is rewritten to it, in the same change;
- written types become facts, obligations and storage widths;
- strict stores.

**Step 2 plan (2026-10-09).** In this order, each landing through the gate;
the vocabulary switch (2d) is one landing, with no compatibility layer:

| | Sub-step |
|---|---|
| 2a | **The library, `@nts/scalars`, types only** (step 3 adds the operations): the fixed widths as optional labels (`Scalar<K>`), C's own types as per-target tables (`CType<Name, Table>`), `CBool`, `CEnum`, `AsNumber`. Adapted from the playground's `scalars.d.ts`, with nts's decided rules in place of its own: an `as` is verified (D4), a float slot takes only an exact value (Q3), and nothing rounds or throws on its own. |
| 2b | **Recognition by the library's marker** (S7): a kind is read from the label the library declares, never from a property name a program could write, and a program's own brand on a scalar keeps the kind. |
| 2c | **Platform tables replace the two ABI models:** the build's targets select each C type's width, the check holds on every target (`Scalar::on` reads the tables), and `NativeAbi` keeps only the calling convention. |
| 2d | **The switch:** every binding generator emits the library's names (C headers, GIR, Objective-C, WinMD, Java); checked-in bindings regenerated; examples, runtime and tests rewritten; `libc.d.ts`'s scalar brands and `CNumber` deleted. Its memory vocabulary (`Ptr`, `Struct`, `Opaque`, `local`) stays in `c:types`. |
| 2e | **Q1 made whole:** arrays and functions invariant in their scalar positions (objects already are), `any` or a type parameter into a written slot a store like any other, and `as` on a container refused unless proven. |
| 2f | **Storage at the written width:** a written field, global, local or array element held at its kind's width in every backend, and a written array as typed storage under S4. **The -0 decision is taken before this**, because a slot that *is* 32 bits cannot hold -0 at all. |
| 2g | **The JVM's unsigned instructions** (E1), before unsigned widths become common. |

**Step 2's first landing, as built (2026-10-09): 2a, 2b and 2d together,
and Q4's check for `AsNumber`.**

- **The library** is `runtime/native/scalars.d.ts`, the ambient module
  `@nts/scalars`, which `libc.d.ts` references. Each kind is its own exported
  type: a `number`, or a `bigint` where every bit of a 64-bit integer is
  wanted, with an optional label. The fixed widths are `Int8` ... `Uint32`,
  `BigInt64`, `BigUint64`, `Float32` and `Float64`. C's own types are
  `c_char`, `c_int`, `c_uint`, `c_long`, `c_ulong`, `c_long32`, `c_ulong32`,
  `c_size_t` and `c_ptrdiff_t`. And `AsNumber<C>` is a 64-bit C kind handed
  over as a number. **Not as planned:** there is no generic `Scalar<K>` or
  `CType<Name, Table>`. A separate name reads better in a binding and in an
  error, and the per-target tables are 2c's. `CBool` and `CEnum` stay in
  `c:types` until 2c moves them.
- **Recognition (2b):** a kind is the label property declared inside
  `declare module "@nts/scalars"`. `native::labelled` walks from the
  property's declaration to its module. The same name written anywhere else
  is an ordinary property: a test spoofs `__Int32` and is refused.
- **The switch (2d):** every generator emits the library's names, imported
  from `@nts/scalars` beside `c:types` (`bind::vocabulary_imports`). That
  covers C headers, GIR, Objective-C (Swift's `Int` is `AsNumber<c_long>`),
  WinMD (Win32 and WinRT) and Chromium's bindgen. `CNumber` and the `c_*`
  brands are gone from `libc.d.ts`, with no alias kept. `runtime/react` moved
  after the React lane's 829db5c13, and its `gen-widgets` reads the new names.
- **`AsNumber<C>` is checked where C hands the number in (Q4).** A call's
  result, and a C callback's argument, is exact up to and including 2^53 in
  either direction, and a `RangeError` past it, never a rounded number. The
  caller can catch a result's error. A callback's error stops the program at
  the bridge, as any throw inside a callback does, since C has nowhere to
  take it. The rule is written once, `FuncBuilder::exact_as_number`. At a
  bridge it runs in a function lowering makes (`nts_exact_number_i64` or
  `_u64`), through the converted-argument mechanism a sequence already used
  (`Bridging::converted`, which replaced `Bridging::sequences`). The
  generated GTK bindings have 18 callback types with such an argument, 16 of
  them GIO's progress callbacks. One fixture runs both paths on C and LLVM
  under both providers, and a sabotage of either half turns it red.
- **Measured:** the strict check over 1,212 of the repo's tsconfigs (all but
  `runtime/react`'s) found no NTS5001, and the projects it could not run are
  the same ones step 1 could not.
- **Left for later landings:** 2c, 2e, 2f and 2g as planned, with `CBool` and
  `CEnum` moving to the library in 2c.

**2c, as designed (2026-10-09).** The research behind it found three facts
the plan did not have:
- the CLI never told the compiler the product's targets, so the strict check
  used the build machine's data model;
- `char` was signed on every target, though it is unsigned on Linux and
  Android for arm64. HIR holds it as a signed byte, so a `char` of 200 read
  from C there would be -56. That is inferred from the representation; there
  is no arm64 machine here to observe it;
- `CBool` and `CEnum` were still recognised by property name alone, which 2b
  ended for the numbers.

It lands in three pieces:

1. **The targets reach the check** (done, 6ec7982c9). A build checks against
   its product's targets, all of them, so every target's build checks the
   same program. `nts facts` and `nts hir` check against every target their
   config declares.
2. **The ABI is a table** (built). `NativeAbi` is a row of data instead of
   two variants: the calling convention (`PlatformConvention`, which also
   decides the bit-field rules), and what C makes of its own types, `char`'s
   signedness and `long`'s width. Three rows cover today's targets:
   - LP64 with signed `char`: x86-64 Linux, and macOS and iOS;
   - LP64 with unsigned `char`: arm64 Linux and Android;
   - LLP64: Windows.

   `NativeAbi::of(os, arch)` picks the row. Each kind is decided from the rows
   in one of three ways:
   - **A store is checked against the intersection** of the product's
     targets' ranges (`Scalar::range_on`). A `c_char` written for both x86-64
     and arm64 Linux takes 0..127.
   - **A read is the union over the product's targets** (`Scalar::reach_on`),
     what C may hand in on any of them. For one target the two agree, so a
     `char` C answers can be handed straight back. The first version used the
     union over every row, and refused exactly that round trip on a plain
     x86-64 build.
   - **HIR holds the union over every row**, so its representation is the
     same on every target, as S6 asks. That was already true of `long` (i64)
     and `size_t` (u64). `char` becomes i16, the narrowest type holding both
     -128 and 255.
   - **A backend crosses at its target's exact type** (`Scalar::abi(row)`):
     `char` is i8 signed or unsigned, and `long` is i32 or i64. LLVM extends a
     loaded or promoted `char` by the row's sign.

   The product's rows live on the program as `Targets`, a set of rows whose
   default is every row. That is the sound assumption where no build has named
   its own; a set that defaulted to empty would have no range at all, which
   reads as nothing to check. `prepare` sets them before the check. The check,
   `written_roots` and the flow analysis's reads of written kinds all take
   them from there. Emitted C asserts the row against the real compiler,
   `char`'s signedness included. A test emulates arm64 Linux's `char` with
   clang's `-funsigned-char`: a `char` of 200 from C reaches the program as 200
   and goes back to C as 200 on both backends. The signed row's `program.c`
   refuses to compile under that flag, and ignoring the row reads -56 on LLVM.
3. **`CBool` and `CEnum` are recognised by their library's label** (built). Each
   names the integer a value crosses as, which the strict check holds the value
   to, so each now counts only when declared in `c:types`, as a number kind
   counts only from `@nts/scalars`. A program's own `__c_bool` is an ordinary
   property, and a function taking one has no native ABI.

   They stay in `c:types` rather than moving into the library. They describe
   how C represents a boolean or an enum, which is `c:types`' subject, and
   moving them would have changed every binding's imports again for no gain.

   The rest of `c:types`' labels (`__c_struct`, `__c_erased` and about fifty
   more) are not covered, because generated bindings write some of them inline:
   the GIR emitter's `__c_gtype`, Chromium's `__c_implements`. Holding all of
   them to the declaring module means either a rule for which modules may
   declare one or the generators naming them through `c:types` aliases. That is
   a hardening item of its own, not part of the numbers.

**2e, as built (2026-10-09): Q1's holes, measured rather than assumed.** Each
of the seven ways TypeScript lets a plain number into a written kind was
written as a program and given to the strict check:
- `number[]` passed as `Uint8[]`;
- `{ x: number }` passed as `{ x: Uint8 }`;
- a function taking `Uint8` used as one taking `number`;
- `any`;
- a type parameter asserted as `Uint8`;
- `as Uint8[]`;
- a function returning `number` called as one returning `Uint8`.

Every one was already closed by step 1:
- an array element and a field read through a structural type carry no kind
  yet, so a value read from one must still be proven;
- a function type's parameters must be written alike (NTS5002), and its result
  is not trusted;
- an `as` must be proven;
- an `any` is a store like any other.

The test `the_holes_typescript_leaves_into_a_kind_are_closed` holds all seven,
each beside a control the check accepts.

The controls found the one real gap. An `any` *guarded* in full
(`typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255`) could
still not be passed on, because the lowering reads an erased value afresh at
every mention: the guards narrowed three reads and the call passed a fourth.
`hir::cse` now reads an erased value once wherever an identical read dominates
it, so a guard and the use it guards are one value. That is also one
conversion instead of four in the emitted code.

Arrays' invariance moves into 2f: an array element has no kind until 2f gives a
written array its element kind, and that is when `number[]` as `Uint8[]` must
become an error rather than an unproven read.

**2f, first piece, as built (2026-10-10): written fields and globals at
their width.** A field or global written as a kind is held at that kind's
width: `r: Uint8` is a byte in its object, `count: Int32` four, `big: Uint32`
an unsigned four, `low: Int16` two, `ratio: Float32` a float.
`hir::written_storage` decides it from the written kind (`Scalar::width_on`,
the narrowest width holding the kind on every target), unconditionally, the
way `written_roots` gives a root's parameters theirs.
- **Stores** were already proven to fit (`Into::Field`, `Into::Global`), so
  `specialize` converts each one exactly to the slot's type.
- **Reads** widen at once to the `number` the program computes with, so `p.r
  + 1` is 256 and not a byte's wrap.
- **The fact-driven narrowing** (`fields`, `globals`) now takes only a slot
  still held as a `number`, so it never turns a written `Float32` into an
  integer.
- **A field is one width wherever its storage is shared.** A class and the
  interface it is read through put the field at one place, and so do the arms
  of one read or store. A kind is an optional label, so one class can write
  `level: Uint8` behind an interface another implements as `level: number`;
  such a group keeps its `number`, and the facts narrow it together, as
  before. Dropping the width from only some layouts in a group wrote a byte
  into a four-byte field.
- **The width holds for a slot the outside can reach**, which the fact-driven
  narrowing skips: there it is a contract the outside is held to, as a written
  parameter's is.
- **Not yet:** an optional field (`x?: Uint8`, erased until the presence-bit
  work), a captured local's cell, and arrays of written kinds (`Uint8[]` is
  still an array of doubles). Arrays need a growable byte, short and int array
  on the JVM, whose runtime has only `NtsArrayD` for numbers.

`examples/a-written-field-held-at-its-width` checks every kind at its edges on
C, LLVM, the JVM and rc. Node holds them all as doubles, so agreement cannot
see a width; `compiler/core/tests/written_storage.rs` pins the widths, the
global, the `Float32` that stays a float, and the shared field that keeps one
width.

Building the example also found a wrong answer that predates this:
`tooling/conformance/outcomes/a-field-through-an-interface-its-classes-order-differently`.
A value whose class was lost (an erased join unerased to an interface) is read
and written at the interface's index, whatever its class lays out, and even a
class that agrees with the interface misses the store. That is the field half
of interfaces satisfied by shape, and the design takes it first.

**2g, as built (2026-10-09): the JVM's unsigned integers.** The JVM has no
unsigned type, so a `u32` is held raw in an `int` and a `u64` in a `long`. Their
top bit is a value bit, and every signed instruction read it as a sign:
- an ordering comparison: `if_icmp` and `lcmp` made `3000000000 > 1` false;
- `l2d` and `l2f`: 2^64 - 1 became -1;
- an `Erase`: a `u32` of 3000000000 read as -1294967296.

Division and remainder were already right. The C and LLVM backends emit
`icmp ugt` and `uitofp` and never had the problem.

- An ordering comparison of unsigned operands calls `Integer.compareUnsigned` or
  `Long.compareUnsigned`, in the branch and the value form alike; equality needs
  nothing.
- One function decides the unsigned widening (`unsigned_to`) for every crossing
  that knows the value's type: `Convert`, `Erase`, and an operand pushed at
  another kind. Before, only a `Convert` of a `u32` had it. What an instruction
  produces (`arraylength`, a Java `long`) is signed and keeps the plain table.
- A `u64` becomes a `double` or a `float` through two runtime helpers that halve
  it with the low bit kept, so the rounding is still to nearest. They round
  straight to `float`, not through `double`, which would round twice.
- `Math.min` and `Math.max` on unsigned integers would be signed. Nothing
  produces them, so they are refused by name rather than left to answer wrong.

Plain TypeScript doesn't hold a `u32` in a register until 2f, so the test
(`jvm/tests/unsigned.rs`) is hand-built HIR at values just past 2^31 and 2^63.
The previous backend gets every unsigned case in it wrong. The JVM lane reviewed
the plan and pointed at the `Erase` and the shared conversion table.

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
2. **Total, and no coercion.** Every function is specified for every input,
   including NaN, -0, Infinity, a fraction and a value outside the kind.
   - **The wrong type** (a string, an object, a `bigint` where a `number` is
     taken) is a `TypeError`, never coerced. This is TC39's current practice,
     and `BigInt.asIntN`'s.
   - **The right type, out of range** is a `RangeError`.
   - **The conversions are the exception by design:** `wrap`, `clamp`, `try`
     and `is` take any number, since deciding what to do with it is their job.
   - **`Uint16(x)`** takes a `number` or a `bigint` only, unlike `BigInt(x)`,
     which also parses strings. `new Uint16(x)` is a `TypeError`, as
     `new BigInt(x)` is.
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

## 6b. Design questions from the 2026-10-08 audit

A separate review checked this plan against everything the playground
raised. It found four questions that change the design, and fifteen smaller
ones.

**Q1-Q4 decided 2026-10-08, as recommended below.** The smaller ones (S1-S13)
are recommendations.

### The four big ones (decided)

**Q1. Can a written type be trusted as a fact?**
- **The problem:** TypeScript lets a plain number into a `Uint8` place in many
  ways, without any check:
  - `number[]` passed as `Uint8[]`;
  - `{ x: number }` passed as `{ x: Uint8 }`;
  - a function taking `Uint8` used as one taking `number`;
  - `any`;
  - generic code;
  - `arr as Uint8[]`.
- **Why it matters:** if nts then trusts "a `Uint8` reads as 0..255" and
  nothing checks at run time, C can receive a wrong value.
- **Recommendation: make it trustworthy.** nts's own check refuses every
  conversion that changes a width, in both directions:
  - arrays, objects and functions are invariant in their scalar positions;
  - `any`, or a type parameter, into a written scalar is a store (D2);
  - `as` on a container is refused unless nts proves it.

  Then a written type is a sound fact, the same guarantee TypeScript itself
  doesn't give. The alternative, facts only from how a value was stored and
  never from its type, is weaker: a parameter `n: Uint16` would prove nothing.

**Q2. Which facts may prove a strict obligation?**
- **The problem:** nts's optimizer infers a function's parameter ranges from
  all its callers. If that also discharged strict checks:
  - adding a caller elsewhere could break the build at a native call nobody
    touched;
  - a compiler upgrade could break a working program;
  - a fact that holds only in a speculative copy (`guards.rs`) could count as
    proof.
- **Recommendation: local facts only,** like TypeScript and Rust. A strict
  obligation is discharged by:
  - what can be proven inside the function;
  - plus written types: parameters, fields, returns, and a binding's return
    and callback-parameter types.

  The whole-program analysis keeps making code fast, but never decides whether
  code compiles. A function that passes its `number` parameter to C writes the
  parameter as `n: Uint16`, and the obligation moves to each caller, where
  it's checked too. Errors stay where the cause is.

**Q3. Floats and -0: node parity.**
- **The problem:** two of the playground's exceptions make nts and node
  disagree:
  - a `Float32` slot rounds in nts and not in node, so `f === 0.1`,
    `includes`, `String(f)` and `JSON.stringify` differ;
  - `-0` stored as an integer becomes `0` in nts and stays `-0` in node
    (`1 / x` tells them apart).
- **Recommendation: make both strict, as D2 is.**
  - Storing into a float slot must be provably exact, or written
    `Float32.round(x)`, which node's polyfill also does.
  - A value that may be `-0` into an integer slot is refused unless proven
    not to be (the analysis already tracks `-0`), or written (`Int32.wrap`).

  Then "nts and node compute the same values" holds without exceptions.
  This replaces the playground's U28 and its `-0` rule.

**Q3 elaborated, before 2f (2026-10-09).** 2f stores a written kind at its real
width: a `Uint8` field becomes one byte, an `Int32` local a 32-bit integer. A
slot that *is* an integer cannot hold `-0`. So 2f rests on Q3's answer, and
this spells out what that answer costs.

- **What `-0` is.** JavaScript numbers have two zeros, `0` and `-0`. They are
  equal (`0 === -0`), print the same (`String(-0)` is `"0"`), and add the same.
  Only a few things tell them apart: `1 / x` (`Infinity` against `-Infinity`),
  `Object.is`, and `Math.atan2` and friends.
- **Where it comes from.** Only a handful of operations make one:
  - negation of zero (`-x` with `x` zero);
  - a zero times a negative (`0 * -5`);
  - a negative divided towards zero (`-1 / Infinity`);
  - rounding a small negative (`Math.round(-0.4)`, `Math.ceil(-0.5)`);
  - `-0` written, or parsed (`parseInt("-0")`).

  Counters, indices, lengths, sums of integers, bitwise results (`x | 0` is
  never `-0`) and anything read from C never are, and the analysis already
  proves so.
- **The rule decided (Q3), as step 1 built it.** A value going into one of the
  program's own integer slots must be proven not `-0`, or it is a compile
  error that says how to prove it (`x + 0` turns `-0` into `0`). A value going
  to C, Java or the web needs no such proof: those languages have no `-0` in
  an integer, and node would hand them `0` too.
- **What it has cost so far: nothing measurable.** In step 1's census of all
  1,248 projects, 1,016 strict errors needed fixing, and **none** was about
  `-0`. The rule is there for parity; in real code it almost never fires.
- **The alternatives, and why not:**
  - *Turn `-0` into `0` silently at the slot.* Fast and invisible, but nts
    would then compute a different value from node for a program that later
    tells the zeros apart: a silent difference. That is the one thing this
    plan rules out everywhere else.
  - *Keep a slot that may hold `-0` as a double.* Correct, but the slot loses
    its width exactly where the program asked for one, and when it does would
    depend on the analysis: the same source could change layout between
    compiler versions.
  - *Track `-0` in the slot (an extra bit).* Doubles the representation for
    something that, measured, never happens.
- **Recommendation: keep Q3 as decided.** 2f can store every written kind at
  its width with no exception, and nts still computes exactly node's values.
  The cost is a compile error, with its fix in the message, in a case the
  census has not found once.

**Q4. Values coming *from* native code.**
- **The problem:**
  - a `size_t` above 2^53 can't be a `number` exactly;
  - a closed C enum can receive a value it doesn't name.

  Both need a run-time check, against "nts never inserts a check".
- **Recommendation: the rule is about values the program sends, and a binding
  is the author of what it receives.** Inbound values are checked where the
  binding's types say so:
  - `AsNumber` throws past 2^53;
  - a closed `CEnum` throws on an unknown value.

  That's a check the binding wrote, not one nts invented. Outbound values stay
  strict. The rule becomes: **nts adds no check that neither the program nor
  its bindings wrote.**

### The smaller ones (recommendations)

| # | Topic | Recommendation |
|---|---|---|
| S1 | **Overloads that differ only by kind** (Java's `append(int)` vs `append(char)`): stock TypeScript picks the first | The binding generators rename kind-only overloads (`appendChar`). D8 wrongly filed this (C33) as checker-only. |
| S2 | **`Uint8.is(x)` under stock TypeScript:** its `else` branch narrows to `never` | `is` is declared returning `boolean`, not a TypeScript guard. nts's engine treats `if (Uint8.is(n))` as the guard. |
| S3 | **What counts as "written"** | Annotations on variables, fields, parameters and returns; explicit type arguments (`new Set<Float32>()`); everything a binding declares, callback parameters included. `T \| undefined` of a scalar is written. Storage width never comes from an inferred type (`let crc = crc16()` is a plain number). |
| S4 | **Arrays and fields of written types** | Never unset: no `!` or `declare` on a scalar field, no holes, `length` growth only by `push`. `x?: Uint8` is "absent or a `Uint8`", with a presence bit. `new Array<Uint8>(n)` is refused (holes); `Uint8Array` or `Array.from` instead. |
| S5 | **Exports and callbacks** | As the playground decided (U59): parameters and returns written, a `number` is a `double`, a plain `bigint` refused. A throw crossing native frames (a `Uint16(x)` failing inside a GTK callback, say) is reported and aborts, and the docs say so. |
| S6 | **Where the targets come from** | The build's config lists targets; the default is the host. A proof holds on every listed target. A type's carrier is the same on every target (a `c_long` is a `bigint` if any target's `long` is 64 bits). C types apply only where C is called. |
| S7 | **Recognising scalar types** | By the library's own marker, not by property names as nts does today. A program's own brand on a scalar (`type UserId = Int32 & {…}`) is still an `Int32`. No compatibility: `__c_*` brands go, and `size_t` and `long` become `AsNumber` numbers. |
| S8 | **Guards on fields** | A guard narrows a local, not a field (`this.n` may change between the test and the use). The error says: copy it to a `const` first. |
| S9 | **Backend rules** | `-ffp-contract=off` (no fused multiply-add JavaScript wouldn't do). Wrapping operations use unsigned arithmetic in C, never signed overflow (undefined behaviour). `Float16` rounds from the double directly. The JVM's `ByteBuffer` set to little-endian where C's layout is meant. To check: whether today's C output already risks fused multiply-add. |
| S10 | **What bindings must carry** | Per-argument types for C variadics (`printf`, `g_object_set`) or they stay refused; string-length units (bytes vs UTF-16 units); range annotations (`@IntRange`, `NonZero`); bit-field widths; sentinels (C37). |
| S11 | **The `@nts/scalars` package** | nts recognises the package by its resolved identity and compiles its functions as operations. The package version ships with the compiler, so they can't skew. |
| S12 | **Testing** | Port the playground's named cases and audit findings as nts fixtures; its ABI tables check (`abi-tables.py`) in the gate; an nts-versus-node run of every scalar program; NaN payloads (node may canonicalize them). |
| S13 | **The census counts stores too** | It already does: step 0 counts native call arguments *and* stores through native pointers (struct fields, buffers). Only values returned by callbacks are not counted yet. |

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
