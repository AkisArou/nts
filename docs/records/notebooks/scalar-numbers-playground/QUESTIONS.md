# Open questions for adopting scalars into nts

These are for the MainClaude session (U63). The plan is `DESIGN.md` "Where this
goes in nts", and the decisions are in `DECISIONS.md`.

Each question says who settles it:
- **user:** only the user decides;
- **design:** worked out in nts;
- **verify:** a fact to check before relying on it.

Where Claude has a recommendation, it is given.

Checked in nts's source on 2026-10-08:
- a `number` passed to a C integer of 32 bits or fewer goes through ToInt32 on
  purpose, following WebIDL's `long` and GJS's `gint` (`lower.rs:27580`,
  `integer_argument`);
- `facts.rs` carries facts across functions, but stops at exported functions
  (`interprocedural.rs`);
- it has no range tracking for bigints;
- node refuses `import … from "nts:scalars"` with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.

## A. Waiting for the user

**A1. Are written slots strict too? (user, C42)**
- U62 made calls strict.
- Should a store into a written scalar slot (`const b: Uint8 = n`, a `Uint8`
  field, a `Uint8[]` element) also be proven or explicitly converted, with no
  check nts inserts?
- **Recommendation:** yes. Then the one rule everywhere is "nts adds no check
  the program didn't write".
- **To settle with it:** a store through a view that loses the width can't be
  proven where it happens. Example: an `Int8[]` passed as `number[]`, whose
  storage stays checked (U53). Either that view is refused (TypeScript's
  arrays are covariant, so nts would refuse what tsc accepts), or those stores
  keep a run-time check.

**A2. Is a written `as` the escape under strict? (user)**
- Without a guard, `crc16(buf, n as Uint16)` resolves a refusal.
- The `as` throws a RangeError, so the program still has a run-time check: one
  it wrote itself.
- **Recommendation:** allow it. It is explicit, it is U31, and without it a
  value from outside (a file, a socket, `Number(text)`) can only be guarded.

**A3. Does "strict only" also rule out a temporary warning while `facts.rs`
learns? (user)**
- Strict breaks existing GTK, Objective-C and Win32 examples that pass numbers
  `facts.rs` can't prove yet.
- **Recommendation:** no warning mode. In this order:
  1. measure the refusals on nts's examples;
  2. add the facts they show are missing;
  3. turn the refusal on together with fixes to the examples that are real
     bugs.

**A4. A smaller `nts:scalars`? (user)**
- `DESIGN.md` "Where this goes in nts" §4: start with the types, `as`, `wrap`
  and `clamp`, and add what the runtime-in-TypeScript code asks for.
- This revisits U32 and U48 (`wrap`, `clamp`, `try`, `is` on every scalar).

**A5. Keep the tsgo fork for editor feedback? (user, later)**
- Without the fork, scalar errors appear at `nts build`, not while typing, and
  a hover shows `number` for an arithmetic result.
- **Recommendation:** decide once nts reports the errors at build. nts could
  publish its own diagnostics to the editor instead.

**A6. Claude's calls, C27-C41 (user)**
- Calls that still matter in nts, fork or not:
  - typed arrays keep JavaScript's semantics (C27);
  - conversions are imported, never global (C29);
  - inferred types are never slots (C30);
  - `Math.round` of a double is a plain number (C32);
  - the export rule is the build's (C35);
  - the library additions (C36);
  - `NSRange.location` is a bigint (C37);
  - float kinds have `round`, not `wrap` (C39);
  - a callback's possible abort is a warning (C40);
  - a float `clamp` keeps ±Infinity and NaN (C41).
- Calls that matter only with the fork:
  - overload ranking for plain numbers (C33);
  - intersection printing (C34);
  - a library without `targets` (C38).
- C28 (the bit functions) is part of A4.

## B. Strict calls

**B1. What does a refusal say, and where does it show? (design)**
- It is nts's own compiler error, as NTS4001 is.
- It should name:
  - the value's proven range (or "unbounded", "may be a fraction", "may be
    NaN");
  - the parameter's C type and its range on the build's targets;
  - the fixes: a guard, `Math.min`/`Math.max`, a mask, `as`, `clamp`.
- The checker's messages (`tsgo/internal/diagnostics/nts_messages.go`) are a
  starting text.

**B2. The program's edge: exported functions and callbacks (design)**
- `interprocedural.rs` stops at exports, so a `number` parameter of an
  exported function is unbounded, and every call that passes it on is refused.
- The same holds for a callback C calls (a GTK signal handler).
- Both have written types: exports must (U59), and a binding types its
  callbacks' parameters (`c_int`).
- So step 1 already needs part of step 2: **a parameter's written scalar type
  as a fact.** Without it, strict refuses every handler that passes its
  arguments on.

**B3. bigint parameters (design)**
- A `bigint` passed to `int64_t` or `uint64_t` needs a proof too, and
  `facts.rs` has no range tracking for bigints.
- Options:
  - a bigint interval domain (simple: no fractions, NaN or -0);
  - requiring `BigInt.asIntN(64, x)` or `x as BigInt64`.
- **Recommendation:** the domain. `now_ns() - start` passed to an `int64_t`
  should prove without ceremony.

**B4. Which stores are calls in disguise? (design)**
- `integer_argument`'s ToInt32 is shared with typed-array stores and with
  stores through a native pointer (`specialize::stored_operand`). U62 covers
  calls.
- **Recommendation:** writes to a native struct field or through a native
  pointer are calls in disguise, so they are strict.
- Typed-array stores stay JavaScript's (C27).

**B5. Proven on which targets? (design)**
- A proof must hold on every target the build compiles C for (U57).
- nts implements two ABI models (`NativeAbi`), and `needs_exact_integer` fixes
  LP64.
- The 17-target tables in `scalars.d.ts` (checked against clang and zig)
  replace both.
- Open:
  - where the build's target set comes from (nts's config, written into the
    library's `targets` marker);
  - what the default is: the native four.

**B6. Java and wasm calls (verify, design)**
- U62 covers calls into Java and wasm too.
- An earlier reading found that the JVM lane wraps arguments to the declared
  width at Java calls (`codegen/jvm` `ops.rs:1946-1980`). Re-check it; strict
  replaces that.
- The hand-built wasm backend gets strict from the start.

**B7. Floats and -0 under strict (user, confirm)**
- A double passed to a `float` or `_Float16` rounds (U55), with no proof
  needed.
- -0 passed to an integer becomes 0, as `DESIGN.md` "The rule" says.
- Both are deliberate exceptions to "C never receives a different value".
  Confirm they stay.

**B8. What changes for the existing examples (verify)**
- The old sweep found two real bugs: `gtk-journal`'s `get_n_items() - 1`, and
  `list-model`'s `remove(row.get_index())`.
- Its tooling isn't saved. In nts the re-sweep is the build itself, with
  strict on.

## C. Written scalar types without the fork

**C1. nts takes over the checks the fork did (design)**
- Stock tsgo accepts `const b: Uint8 = 300` and `const b: Uint8 = i32`,
  because the labels are optional.
- So every rule in `DESIGN.md` "What converts without a cast" becomes nts's
  error, decided from facts.
- nts already reads the labels (`from_brand`). The declared types survive in
  tsgo's snapshot; only arithmetic results lose them, and facts don't need
  them.

**C2. Overloads that differ only by kind (design)**
- Stock tsgo can't tell `append(int)` from `append(char)` for a `Uint16`
  argument, because every kind is assignable to every other. The first
  overload wins.
- The fork fixed this; without it the call goes to the wrong method.
- This occurs in Java and WinRT; C has no overloads, and Objective-C selectors
  differ.
- Options:
  - the binding generator renames kind-only overloads (`appendChar`);
  - nts re-resolves among the overloads tsgo saw, using kinds.
- **Recommendation:** renaming. It is rare, and re-resolving would be a second
  overload resolver.

**C3. Storage widths for arrays and fields (design)**
- A written `Uint8[]` stored as bytes meets JavaScript's array behaviour:
  holes, `length` growth, `push`, and views (A1).
- U53 (storage, not the static type) and U54 (never unset) are the rules.
- How `specialize.rs` represents such an array, and what a `number[]` view of
  it costs, is nts's design.

## D. The library and packaging

**D1. `nts:scalars` doesn't load under node (design, user)**
- Node refuses the `nts:` scheme. So a program that imports
  `Uint8.wrap` runs under nts but not under node, and node-parity tests fail.
- Options:
  - a package node resolves (`@nts/scalars`, with `runtime.js` as its
    implementation), which nts compiles to instructions;
  - a node loader hook.
- **Recommendation:** the package. It is "Packaging" in `DESIGN.md` "Open"
  too: emitted `.d.ts` files need the library.

**D2. Moving nts's bindings to the library (design)**
- `libc.d.ts` becomes `scalars.d.ts`, and `CNumber` becomes `Scalar`.
- The generators (GIR, Objective-C, Win32, Java) emit the new types, with
  sizes as `AsNumber` (U56).
- Objective-C's `Int64`/`UInt64` become `bigint`.
- The existing brands (`c_int64` …) need a migration.

## E. Backends

**E1. The JVM's unsigned defects (design)**
- `JVM-UNSIGNED-BUG.md`: the JVM lane compares unsigned integers as signed,
  and converts a u64 to a double as signed.
- Claude never reported it to MainClaude (C15). Fix it before unsigned widths
  are common.

**E2. Kinds a backend can't hold natively (confirm)**
- Examples: `Float16` arithmetic; `Float80`/`Float128` as doubles; 128-bit
  integers on the JVM.
- `DESIGN.md` "Backends" gives each kind's representation per backend; confirm
  it against nts's lanes.

## F. Still undecided (`DESIGN.md` "Open")

- **Ranges and sentinels:** `@IntRange`, `NonZero`, `NSNotFound` (2^63-1),
  C bit-fields.
- **String-length units:** bytes, UTF-16 units, code points, `wchar_t`.
- **The float environment:** rounding modes, flushed subnormals, NaN payloads.
- **C variadics:** `printf`'s `...` promotes its arguments, so a binding must
  type each one.

## G. How to verify it in nts

- **The tour as fixtures.** Each case-3 call has an expected outcome under
  strict: proven, or refused with a given fix. The lines that change are
  listed in `DESIGN.md` "Where this goes in nts" §1.
- **The checker's algebra as an oracle.** `nts_scalars_algebra.go` and its
  tests define exact ranges for `+ - * / % & | ^ << >> >>>` per kind and
  target. Random expressions can check `facts.rs`'s transfer functions
  against it.
- **`runtime.js` and its oracle** (11.8M checks) define `wrap`, `clamp`, `as`
  and float rounding, as nts's intrinsics must compute them.
- **What "done" means for strict:** every refusal on nts's examples is
  classified as a real bug (fixed in the example) or a missing fact (added to
  `facts.rs`).
