# Scalar types: the decision record

This file records every decision the user made about the scalar-types experiment, and every commitment Claude made to the user. Each entry has its source and its status as of the audit.

**How to use it:** before any rewrite of `DESIGN.md`, `README.md`, the tour or the checker, diff the change against this file. If a change touches a decision, tell the user before making it. An item marked "designed, not built" stays listed until it is built or the user drops it.

## Provenance

- **Source:** the transcript `60d31c1a-…jsonl`. The scalar work begins at line 3372 (2026-10-07 02:40 UTC). This file covers it up to line 8755 (2026-10-08 00:57 UTC); statuses updated at v19.1 (2026-10-08 07:30).
  - `L<n>` is a line number in that file. Times are UTC.
  - Mid-turn messages are the transcript's `queued_command` attachments.
  - Decisions also come from AskUserQuestion answers and from rejected or approved plans.
- **State checked:**
  - `~/Projects/nts-playground`: `DESIGN.md`, `README.md`, `JVM-UNSIGNED-BUG.md` and `scalars/`;
  - `tsgo` at `5136b76c8` (v18), plus the uncommitted `as` change built as `tsgo-v19`; re-checked against v19.1 and its successor by the ledger audit of 2026-10-08;
  - the drafts in `jobs/60d31c1a/tmp/conv/`;
  - the memory note and the plan file.

## Status words

| Status | Meaning |
|---|---|
| HONOURED | in force, with a file and line as evidence |
| PENDING | decided, but not yet in the tour, `DESIGN.md` or a commit |
| SUPERSEDED | replaced by a later decision, and the user was told |
| SILENTLY CHANGED | replaced, and the user was not told |
| DROPPED | decided or promised, and gone now |
| CONTRADICTED | the current state says otherwise |
| STALE | the docs say something that is no longer true |
| STILL OPEN | unresolved, and still visible to the user |
| UNVERIFIABLE | cannot be checked from here |

---

## 1. The user's decisions and instructions

### Scope and working rules

| ID | When | The user's words | What it decided | Status and evidence |
|---|---|---|---|---|
| U01 | L3380, 10-07 03:00 | "readonly for the existing files. we might create some just for testing purposes" | The nts repository is read-only. | **HONOURED, with two incidents Claude disclosed at L5258:** 8 probe files were written into the nts repo root and then moved out; the shared `~/.cache/nts/snapshots` was polluted, and 1,333 entries were deleted. Nothing in the nts repo was changed. |
| U02 | L3380 | "create a file as a playground … isolated … not use or import anything that we have" | The playground is self-contained. | **HONOURED.** `archive/numbers-v0/`; `scalars/tsconfig.json` (`"types": []`, no imports from nts). |
| U03 | L3598, L3620 | "Do not do any modifications to numbers.ts yet" | `numbers.ts` is frozen. | **HONOURED.** Claude made no edit after 03:44. The file was moved to `archive/numbers-v0/` under the approved plan at L6700. Its modification time (10-07 17:54 UTC) matches no Claude tool call, most likely the user's editor. |
| U04 | L3738 | "b. I want ts-go patched. Let's experiment with it" | The checker gets patched. | **HONOURED.** `tsgo/`, branch `scalars-v2`, versions v1 to v18. |
| U05 | L3863, mid-turn | "create a .nvim.lua … override the typescript lsp" | The editor uses the patched tsgo. | **HONOURED.** `.nvim.lua` starts `tsgo-scalars --lsp`. |
| U06 | L3937 | "In the end we should do a nice audit." | The work gets audited. | **HONOURED.** Fourteen audits have reported (the fourteenth at v19, `AUDIT-2026-10-08.md`), and a ledger audit checked the v19 rewrite against this file. |
| U07 | L4053, L4080 | "build it in another worktree" … then "do it straight here without any worktree that complicates things" | Work directly in the tsgo clone. | **HONOURED.** `git worktree list` shows the clone only. |
| U08 | L4053 | "implement proper testing. We have to get scalar types/numbers 100% correctly!" | Thorough testing. | **HONOURED.** `test.sh`: the oracle, baselines run three times, refusal pairs, determinism, the tour and the conformance suite. |
| U09 | L6621 + L6743, 10-07 18:54 | "then we ping MainClaude for adoption" … "do not ping MainClaude until I explicitly ask it. I wanna see the 'finished product' in the tour file." | No contact with MainClaude. The tour is the finished product. | **No contact: HONOURED** (and U61). **Finished product: BUILT.** The tour has `as` and the conversions (`2-scalars-in-app.ts`, `checks.ts`), with 0 errors under the patched checker. |
| U10 | L7903 | "do not be limited by our current implementations" | Design beyond what nts does today. | **HONOURED.** `DESIGN.md:107-172` (Backends). |
| U11 | L7906 | "we'll probably build wasm by hand, and not compile C. Maybe both though" | wasm is not a C target by default. | **HONOURED.** `DESIGN.md:134-143`; `scalars.d.ts:10-13`. |

### The design

| ID | When | The user's words | What it decided | Status and evidence |
|---|---|---|---|---|
| U12 | L3380 | "investigate unification of c_* and CNumber<*>" | One family. | **HONOURED.** `Scalar<K>` (`scalars.d.ts:76`). Adoption is listed at `DESIGN.md:334-340`. |
| U13 | L3380 | "when a number … is 16bits and … a function call that accepts 32 bits, it doesn't need a cast … Only the opposite" | Widening is implicit and narrowing is explicit. | **HONOURED.** `DESIGN.md:200-211`; `checks.ts:10-33`. |
| U14 | L3380 | "I also want our TS scalar numbers to be interoperable with C ones" | Our scalars and C's types interoperate. | **HONOURED in the playground** (`checks.ts:121-136`). **However:** since v17 the fixed widths carry `__Int8` labels, which nts's `Scalar::from_brand` does not read (`compiler/core/src/hir/native.rs:4203-4225` reads `__c_*` only). See C01. |
| U15 | L3472, mid-turn | "add some real code usage examples, every case … a +b" | The tour shows real code. | **HONOURED.** `2-scalars-in-app.ts:45-122`, and cases 3 and 4 for each backend. |
| U16 | L3598 | "we should be close to js spec interfaces IF possible" | Prefer JavaScript's own vocabulary. | **HONOURED.** The typed-array names; `clamp` rounds as `Uint8ClampedArray` does (U49). |
| U17 | L3598 | "let b = i32(5); const c = b++ … c is a number and not an i32. Can we solve it" | `b++` keeps its kind. | **HONOURED.** `2-scalars-in-app.ts:14-17`. |
| U18 | L3598 | "I do not see any examples of usage of builtin Math.sqrt(...) and other Math.*" | Show `Math.*`. | **HONOURED** since v19: `2-scalars-in-app.ts` has `Math.sqrt(i32)` (a Float64) and `Math.sqrt(Number(i64))`, beside `imul`, `trunc`, `round`, `min`, `max` and `fround`. |
| U19 | L3620 | "1. I agree mostly" with L3616's package: typed-array names, a throwing `Int32(x)`, an `Int32.is(x)` guard, `.wrap`/`.clamp`, a plain number accepted at boundaries, `Math` overloads where the spec guarantees a width | The conversion API. | **HONOURED.** Names and plain numbers; `Int32(x)` is the checked `as` (U31); `.is` is back (U48); `.wrap` and a rounding `.clamp` (U32, U49); Math knows widths given scalars (U51). |
| U20 | L3648, 10-07 04:11 | "This seems much more inconvenient. (this \| 0) especially. I was just talking about the .wrap naming … If not, keep wrap." | **Keep `.wrap`; do not replace it with JavaScript operator idioms.** Claude confirmed at L3728: "Keep `wrap`". | **HONOURED** since the v19 ledger audit. The last two idioms the tour taught (`c/4`'s `index >>> 0`, `wasm/4`'s `(delta << 16) >> 16`) are now `c_uint.wrap(index)` and `Int16.wrap(delta)`. `\| 0` and `>>> 0` stay legal JavaScript and count as a written wrap (U52). |
| U21 | L3648 | "2. It's up to you! I trust you on this." | Claude decides how plain numbers and labelled values meet. | **HONOURED.** At L3728 Claude decided a plain number is accepted and a labelled value is checked: `checks.ts:35-39`; `2-scalars-in-app.ts:33`. |
| U22 | L3738 | "I thought we could leverage scalar types to normal non C library interfacing code … facts.rs" | Scalars are for ordinary code too. | **HONOURED.** Case 2 (`2-scalars-in-app.ts`). |
| U23 | L3937 | "Overflow … and … Uint8 + Int8 … its up to you" | Claude decides. | **SUPERSEDED by U52** (exact results; past every kind, a result keeps its operands' kind). Mixed signs: the exact range decides the kind. |
| U24 | L3937 | "facts.rs is an 'inference' mechanism. Of course we should not be limited by it." | Types are guarantees, not inferences. | **HONOURED in substance.** `DESIGN.md:186,319`. The explicit statement ("Decisions" item 1 in `DESIGN` v1) has been gone since v2. |
| U25 | L6577 | "is it opt in? … if he continues working with number bigint, it should be plain TS like plain v8 nodejs" | Plain code is plain TypeScript. | **HONOURED.** `1-plain-js.ts`; `test.sh:50-51`. The binder cost is disclosed at `DESIGN.md:99-105`. |
| U26 | L6577 | "My concern is the DX but also the performance of apps" | Both matter. | **Performance: OPEN, and now listed** in `DESIGN.md` "Open" (the performance half). Today nts lowers a label off the C boundary to `f64` (`JVM-UNSIGNED-BUG.md:38`). |
| U27 | L6621 | "I think bindings should be our 'type Int8 = … BigUint64'" | Bindings use our scalar names. | **Ignored at first.** The approved plan at L6700 kept `crc16(…, c_uint16): c_uint16`. **HONOURED since v15**, after the user raised it again (U34): `c/libdemo.d.ts:10`. |
| U28 | L6621 + AskUserQuestion at L6655 | "Float32 lenient or strict; -> I guess lenient??" → "Accept every number (Recommended)" | A float slot rounds any number. | **HONOURED:** `DESIGN.md:213-219`; `checks.ts:61-70`. The mechanism moved from the type relation (v13) to the slot (v15); the user was told at L7678. `satisfies` and inferred generics don't round; the user was told at L8617. **No longer recorded as the user's decision** (C04). |
| U29 | L6621 | "binding returns labelled or plain; -> labelled" | Binding results keep their kind. | **HONOURED:** `c/3-calling-c.ts:18,26`. **No longer recorded as the user's decision** (C04). |
| U30 | AskUserQuestion at L6655 | includes → "Accept any kind (Recommended)"; `let` → "most dev will write 'const crc = crc16(...)' though, and it keeps c_uint16.. … Think about it very well please.." | Search methods take any number. No `let` widening. | **Search: HONOURED** (`DESIGN.md:257`; `checks.ts:110-119`). Narrowed in v15 to keep a program's own brands; the user was told at L7678. **`let`: HONOURED** (`c/3-calling-c.ts:48-55`), but `DESIGN` no longer states it, and the related cost was dropped (C06). |
| U31 | L8622 + AskUserQuestion at L8640, 10-08 00:44 | `x as Uint8` → "A checked conversion (Recommended)" | `as` to a scalar is a written slot: a literal is checked at compile time, and a value at run time. | **BUILT** (v19, `39ac867e8`): `as` to a scalar is a checked conversion; a literal no kind of the target (or of a type parameter's constraint) holds is refused with advice (TS99005: `Uint8.wrap(300)` is 44, `Uint8.clamp(300)` is 255). `DESIGN.md` "The rule". |
| U32 | AskUserQuestion at L8640 | wrap/clamp/try → "Yes, on every scalar (Recommended)" | `X.wrap`, `X.clamp` and `X.try` on every scalar. | **BUILT**: `IntegerFunctions`/`FloatFunctions`/`FloatBitsFunctions` in `scalars.d.ts`, imported from `"nts:scalars"` (no globals), on every kind including the C types; `runtime/runtime.js` with its oracle (11.8M checks, 11 mutants). **One deviation, Claude's call C39:** float kinds have `round` in place of `wrap`. |
| U33 | L8677 | "probably those Uint8(...).* etc should be compiler intrinsics? or plain functions like you have in numbers-v0?" | A question. | **Reference BUILT** (`runtime/runtime.js`); the intrinsics in nts are adoption work (`DESIGN.md` "Open"). |

### Names and completeness

| ID | When | The user's words | What it decided | Status and evidence |
|---|---|---|---|---|
| U34 | L7170 | "eliminate things like type c_int8 = CNumber<"int8">; in favor of Uint8? And only have c_* for things that we cannot express?" | Fixed widths use the JavaScript names, and `c_*` names only C's own types. | **HONOURED.** `scalars.d.ts:103-131` has no `c_int8` … `c_uint64`. |
| U35 | L7170 | "I guess it would be nice to also introduce Char" | A `Char` type. | **SUPERSEDED, with notice.** Claude advised against it at L7207, and the user approved the plan at L7249 that says "Deliberately not scalars: Char". `DESIGN.md:84-86`. |
| U36 | L7209 | "It does not matter that there is no usage of BigInt128 … declare completeness … never rethink about scalar types … Add it." | Every kind. | **HONOURED** at the type level (`scalars.d.ts:87-131`). The new kinds in nts's compiler are listed as open (`DESIGN.md:332`). |
| U37 | L7209 | "what about making it Int64 etc and ditch the Big* prefix? What do you think?" | A question. | Claude recommended keeping `Big`, and the user approved the plan at L7249. **HONOURED** (`DESIGN.md:82-83`). At L7678 Claude wrote "since you agreed"; the agreement was the plan approval. |
| U38 | L7209 | "Unify [CNumber/CBig] and find a proper name for the type." | One generic. | **HONOURED.** `Scalar<K>` (`scalars.d.ts:76`). |
| U39 | L7209 | "we should have the full c_* scalar types that rust and zig 'use'" | The full C type set. | **HONOURED.** `scalars.d.ts:103-131`. |
| U40 | L7839 | "Now that we included jvm and wasm, does it even make sense to be like this [C kind names]??" | One vocabulary. | **HONOURED** (v17, `scalars.d.ts:58-78`). Its side effect is in C01. |

### Backends and platforms

| ID | When | The user's words | What it decided | Status and evidence |
|---|---|---|---|---|
| U41 | L7774 | "What about our jvm target? Also we are gonna target wasm" | Cover the JVM and wasm. | **HONOURED.** `DESIGN.md:107-172`. |
| U42 | L7818 | "include the updated scalars.d.ts with jvm and wasm … Write down the bug of jvm." | Show both, and record the bug. | **HONOURED.** `scalars.d.ts:21-52`; `JVM-UNSIGNED-BUG.md`. |
| U43 | L7880 | "should we also declare type jvm_* … wasm too?" | A question. | Claude said no, and the user approved the plan at L7936. **HONOURED** (`DESIGN.md:151,155`). The memory note wrongly calls this "User's call". |
| U44 | L7880 | "create some realistic equivalent of bindings.d.ts … a java for android and a wasm one … create a c/jvm/wasm dirs" | Per-backend folders. | **HONOURED.** `scalars/{c,jvm,wasm}/`. |
| U45 | L8723, 10-08 00:55 | "add windows, ios, macos, gtk too. (does it also make sense to make them 'bidirectional'? …)" | New platforms, and both directions. | **BUILT**: `scalars/{windows,macos,ios,gtk}/` with cases 3-5, and `5-called-from-*.ts` for c, jvm and wasm. Both directions. |
| U46 | L8723, L8732 | "make a research on zig or rust … I am talking about if we may have missed out any serious concept" | A concept-gap research. | **DONE**: the concept research (Rust, Zig, Swift, Kotlin, .NET, Go, Ada; platform ABIs) is in `AUDIT-2026-10-08.md` sections A-E; its decisions are U52-U59. |
| U47 | L8754+, 10-08 | "probably with the perspective of both 'js-like developer that writes numbers and bigints' and 'the advanced dev that can handle scalars'" | Every platform folder shows both readers. | **BUILT**: every case 5 has a JavaScript-developer half and an advanced half; cases 3 and 4 are the two perspectives for calling. |
| U48 | AskUserQuestion, 10-08 | `.is` → "Yes, on every scalar (Recommended)" | `Uint8.is(x): x is Uint8` on every scalar. | **BUILT**: `is(x): x is T` on every kind (`scalars.d.ts`, `runtime.js`). |
| U49 | AskUserQuestion, 10-08 | clamp → "Round, like Uint8ClampedArray (Recommended)" | `clamp` rounds half to even, then saturates; NaN gives 0. | **BUILT**: `clamp` rounds half to even and saturates; NaN is 0; checked against a `Uint8ClampedArray` store (`runtime.test.mjs`). |
| U50 | AskUserQuestion, 10-08 | let → "Widen operator results (Recommended)" | An unannotated `let` widens an operator's scalar result to its carrier. A binding's return and a variable read keep their kind (U30 stands). | **BUILT** (v19): `ntsWidenedOperatorResult`; baseline `ntsScalarsLetAndEquality`. |
| U51 | AskUserQuestion, 10-08 | Math → "Only when given scalars (Recommended)" | `Math.*` overloads that return a kind only when every argument is a scalar; plain numbers give plain numbers. | **BUILT** (v19): `ntsMath`; nested min/max pass exact ranges up; baseline `ntsScalarsMath`. |
| U52 | AskUserQuestion, 10-08 (audit A2/A3) | arithmetic → "Exact, plus lossy-operand checks (Recommended)" | `+ - *` answer the smallest kind holding the exact result; only past every kind (32 bits for a number, 128 for a bigint) do they keep the operands' kind. A bitwise operator, `%` or `wrap` given an operand wider than it handles losslessly, or possibly past 2^53, is an error unless the wrap is written (`\| 0`, `>>> 0`, `& mask`, `X.wrap`). | **BUILT** (v19): exact results; claims past every kind; operators read operands' exact ranges; lossy operands refused (TS99003/99004); baseline `ntsScalarsExact`. One reading of mine: a remainder by a divisor that may be 0 keeps its kind (a claim, NaN caught at the slot) -- `DESIGN.md` "Known limitations". |
| U53 | AskUserQuestion, 10-08 (audit A1/C1) | slots → "Storage (Recommended)" | A slot is storage: an array or field created with a scalar type checks every store, through any view. Converting a reference converts nothing. | **DESIGN** (a backend contract: the checker cannot see run-time views). The checker's half: a receiver's type argument rounds only where the receiver's type was written (`const xs: Float32[]`), not inferred. |
| U54 | AskUserQuestion, 10-08 (audit C2) | non-numbers → "TypeError, and never unset (Recommended)" | A wrong-carrier value into a scalar slot is a TypeError. The checker refuses scalar-typed `!` and `declare` fields; a store that would leave holes in a scalar array is a RangeError. | **BUILT** (checker half, v19): scalar `!`/`declare` fields and `let x!` refused (TS99006). The TypeError for a wrong carrier is nts's runtime contract. |
| U55 | AskUserQuestion, 10-08 (audit C3) | float overflow → "Rounds to Infinity (Recommended)" | A float slot rounds to its width, past its range to ±Infinity, and never throws. A literal that would become Infinity stays a compile error. | **BUILT**: a float slot rounds to Infinity past its range and never throws; only a literal that would become Infinity is refused. `DESIGN.md`, `scalars.d.ts`, `runtime.js` agree. |
| U56 | AskUserQuestion, 10-08 (audit A7, E) | sizes → "Checked numbers (Recommended)" | Bindings give sizes, counts and indices (`size_t`, `ssize_t`, `NSInteger`, `gsize`, `CFIndex`, `SIZE_T`) as `AsNumber<…>`: a number, exact to 2^53, a RangeError beyond in either direction. Bigints stay where every bit matters (hashes, ids, ns times, `uint64_t`). `AsNumber` never rounds silently. | **BUILT.** Every binding gives sizes, counts and indices as `AsNumber`; `strlen` and `wcslen` in `c/libdemo.d.ts` were the last two, fixed after the ledger audit. Bigints stay for hashes, ids and nanoseconds. |
| U57 | AskUserQuestion, 10-08 (audit C10/C11) | C typedefs → "Declared with a table (Recommended)" | A target-dependent C type is declared with its per-target table (`CType<"c_wint_t", {…}>`), float rows allowed; the 11 built-in C kinds become such tables; targets are full triples (`windows-x64-gnu`, `ios-arm64`, `android-armv7`, `watchos-arm64_32`, …). | **BUILT** (v19): `CType<Name, Table>`; 17 targets; the library's C types are tables, checked against clang and zig by `tests/abi-tables.py` (391 rows, 0 mismatches); bindings declare their own (`LPARAM`, `NSInteger`, `CGFloat`, `gsize`, `GType`). |
| U58 | AskUserQuestion, 10-08 (audit C8/C9) | bool/enum → "CBool and open CEnum (Recommended)" | `CBool<K, True = 1>` is a `boolean` carried as K; nonzero reads true; tri-states bound as their kind. `CEnum<Members, K, "open" \| "closed" \| "flags">`, open by default. | **BUILT** (types): `CBool<K, True>`, `CEnum<Members, K, Mode>` in `scalars.d.ts`, used by the Win32, AppKit, UIKit and GTK bindings. Their run-time behaviour is nts's contract. |
| U59 | AskUserQuestion, 10-08 (audit C7) | exports → "Written types; a throw aborts (Recommended)" | Every export parameter and return is written (inferred refused); `number` is `double`, `boolean` is `bool`, a plain `bigint` is refused. A throw that would cross C frames aborts, naming the slot. The checker warns where a callback returns arithmetic into an integer kind. | **BUILT** (checker half, v19): TS99011 warns where a callback a binding calls returns arithmetic that may not fit; baseline `ntsScalarsCallbackAbort`. The export rule is nts's build (the checker cannot tell the entry module); the tour shows those exports as code nts refuses. |
| U60 | 10-08, mid-turn | "When you finish and you are confident, you can reach to the main MainClaude agent and present your work, discuss it, and probably integrate it!" | Lifts U09's hold: once finished and confident, present the work to MainClaude, discuss, and integrate. | **SUPERSEDED** by U61. |
| U61 | 10-08, mid-turn, later | "I changed my mind. whenever you finish, do not contact MainClaude main agent for discussion and merging. We will talk again when I wake up" | No MainClaude contact; U09 stands until the user says otherwise. | **HONOURED** overnight. The user now contacts MainClaude themselves (U63); Claude still does not. |
| U62 | chat, 10-08, after the ScriptC comparison | "lets start with strict only." (on Claude's proposal that unproven calls get a run-time check by default and ScriptC's refusal be a build flag) | **Calls are strict:** a number passed to a call into C, Java or wasm must be proven by nts's range analysis (`facts.rs`) to fit the parameter; unproven is a compile error, like disproven. nts inserts no range check at a call; the program may write one (`as`, `clamp`), or a guard. Supersedes the run-time check at calls (DESIGN case 3 since the plan at L6700). | **DESIGNED** in `DESIGN.md` "Where this goes in nts" §1. The frozen checker and the tour still show the earlier rule. Whether written slots are strict too is open (C42). |
| U63 | chat, 10-08 | "integrate the things you just said into the appropriate doc file. I will contact the MainClaude main agent, and probably work directly there." | The direction Claude proposed is the plan: one range analysis (`facts.rs`) for safety and optimization; written scalar types as its facts, obligations and storage widths; the patched checker frozen as the reference. The user takes it to MainClaude and works in nts. | **WRITTEN** into `DESIGN.md` "Where this goes in nts". The smaller `nts:scalars` (§4) is a proposal that revisits U32/U48 and waits for the user. |

---

## 2. Claude's commitments and claims

| ID | When | What Claude said | Status and evidence |
|---|---|---|---|
| C01 | L3586 | "It keeps the `__c_<kind>` key that `Scalar::from_brand` already reads, so the compiler would recognise it unchanged." | **FIXED.** No file calls `__Int8` the key nts's compiler reads today; adoption makes `from_brand` read it (`DESIGN.md` "Open"). |
| C02 | L3616, L3728 | "`Uint8.clamp(x)` (should round as the spec does, not truncate as mine does)"; clamp's precedent is `Uint8ClampedArray`. | **FIXED by U49:** `clamp` rounds half to even (`runtime.js`, `roundHalfEven`), checked against `Uint8ClampedArray` by the oracle. |
| C03 | L3728, written into `DESIGN` v1 (L3997) | "`Int32(x)` checks and throws RangeError … `Int32.is(x)` is a type guard. `.wrap` and `.clamp` cover the rest." | **FIXED:** `Int32(x)` is the checked `as` (U31), and `.is` is back (U48). |
| C04 | L4012 | "DESIGN.md records the rule, the promise, the decisions, the costs and what's still open." | **DROPPED.** `DESIGN` v1 had a "## Decisions" section, which v2 removed. A "Decided (v13)" line, added at v13, was removed by the v15 rewrite (L7627). Today's `DESIGN` has no decision record: U28, U29 and U30 appear only as rules. This is the root cause of the misses. |
| C05 | L4012, `DESIGN` Costs v1-v14 | "Fractions throw … nts's C boundary converts with ToInt32 today, so this changes existing behaviour for GTK/ObjC/Win32 bindings." | **LISTED again** in `DESIGN.md` "Costs" after the ledger audit; still true (`c/3-calling-c.ts`, `set_size(width / 3, 480)`). |
| C06 | `DESIGN` Costs v3-v14 | "an inferred variable whose type is a scalar (`let t = i32 + i32; t = 0.5` is an error)" | **FIXED by U50:** a `let` widens an operator's result, so `let avg = i32 + i32; avg /= 2` compiles. |
| C07 | L6616 (plan the user read) → L6699/L6700 (answer and approved plan) → v13 `README` → v15 `DESIGN` | "Namespace helpers like `Int32.wrap(n)` are designed but not built" became, 48 minutes later, "must be written … with JS's own operators: `& 0xffff`, `>>> 0`, `Math.round`". | **SILENTLY CHANGED.** Claude admitted it at L8699, but dated it only to the v15 rewrite. The drift began at L6699/L6700 and in `README` (L6953). |
| C08 | L3616 (rec. 4), approved plan L6700; `DESIGN` Open v1-v3 | Precise `Math` signatures: `imul → Int32`, `fround → Float32`, `clz32 → Uint8`, `Math.max(Int32, Int32): Int32`. | **BUILT by U51:** given scalars, `Math.imul` is an Int32, `fround` a Float32, `clz32` 0..32 and `max` of two Int32s an Int32. Given plain numbers, every signature is TypeScript's. |
| C09 | L6615 | "The RangeError at a binding parameter is designed but not built in nts yet." | **STILL OPEN, listed.** `DESIGN.md:332`. |
| C10 | L6699 + plan L6700 | "What the JS developer pays: an error only where C would have silently received a different value … The one other case is reusing a `let`"; "a binding's return type is a declared type … only fresh literals widen". | **HONOURED** since U50 (a `let` widens). |
| C11 | L6699, plan L6700 | "The one judgment call … throw (the plan) versus wrap like `Uint16Array`." | **HONOURED.** The plan was approved. `DESIGN.md:183`. |
| C12 | Plan L6700 | Archive `numbers-v0`; delete `tsgo-scalars-v1`/`-v2`; port `scalars-checker/` into `scalars/`. | **HONOURED.** |
| C13 | Plan L6700 | `test.sh`: "scalars/ minus checks.ts: 0 errors under patched and stock". | **SUPERSEDED, with notice** (L6987): "only claims fail under stock" (`test.sh:42-51`). Verified: patched 0 errors; stock 35 TS2344 and 47 TS2578, nothing else. |
| C14 | L7164 | The narrowing order limitation "will go into DESIGN.md". | **HONOURED.** `DESIGN.md:305-307`. |
| C15 | L7816, plan L7936 | The JVM bug is reported to the user only, not to MainClaude. | **HONOURED.** `JVM-UNSIGNED-BUG.md:7`. **UNVERIFIABLE at HEAD:** "latent today" was probed with `target/release/nts` built 10-03, and 25 commits have touched `codegen/jvm` or `specialize.rs` since. The comparison code at `ops.rs:4815-4823` is unchanged. |
| C16 | Plan L7936 | "A wasm32 mini-project under `tests/targets-wasm32/`". | **CHANGED without notice, substance kept.** No mini-project exists. The checker baselines `ntsScalarsTargetsWasm32`, `…Linux` and `…Unknown` cover it. |
| C17 | Plan L7936 | Remove the `CBig` and `__c_` mentions from code comments. | **HONOURED.** No matches in `nts_scalars*.go`. |
| C18 | L8617 | The `test.sh` case-1 check was fixed. | **HONOURED.** `test.sh:50-51`. |
| C19 | L8721 | "`300 as Uint8`, `0.5 as Int32` and `1e39 as Float32` are now compile errors"; the conversion test passes, and "breaking one conversion makes it fail 18 times". | **Verified** on `tsgo-v19`, uncommitted. The test passes (node v24.20.0). The count of 18 is UNVERIFIABLE; a clamp sabotage gave 12. |
| C20 | L8699, L8721 | Fold the audits' findings in; add `as` and the conversions to the tour; report "any further decisions I changed without telling you". | **DONE.** `AUDIT-2026-10-08.md` section F; the tour has `as` and the conversions; the changes are reported in `REPORT-2026-10-08.md`. |
| C21 | L8754 | New folders `windows/`, `macos/`, `ios/`, `gtk/`; `5-called-from-*.ts` everywhere. Candidate gaps: overflow modes, boolean widths, enums and bitfields, bit reinterpretation, variadic promotion, iOS/Android/armv7 targets, check modes. | **DONE**, except variadic promotion, which is now in `DESIGN.md` "Open". Overflow modes: the bit functions (C28). Booleans: `CBool`. Enums: `CEnum`. Bit reinterpretation: `toBits`/`fromBits`. Targets: 17 (U57). Check modes: U52. |
| C22 | `DESIGN.md:300-303` | "Each is a static check that is missed, never a false claim, except one inherited from TypeScript." | **FIXED:** `DESIGN.md` "Known limitations" says "false claims or false errors" and lists them. |
| C23 | `DESIGN.md:261`, `:326` | Results print as `Scalar<"char" \| "int8" \| "uint8">`. | **FIXED:** results print as intersections, `Int8 & Uint8 & c_char` (C34). |
| C24 | `DESIGN.md:185` | "meets no scalar exception except at a C call" | **FIXED:** the sentence is gone. |
| C25 | `DESIGN` Known limitations v4-v14 | `(Int8 \| Uint8)[] = [1, 300]`, `[...[300]]` and `for (const a of [300])` are accepted. | **LISTED again** in `DESIGN.md` "Known limitations"; still true on v19 (verified: `[1, 300]` into `(Int8 \| Uint8)[]` is accepted). |
| C26 | L6653 | "with stock tsgo … scalars are just numbers: no false errors and no checks" | **Corrected, with notice.** Stock gives two wrong answers (guards, `T extends Float32`); disclosed at `DESIGN.md:320-324` and L7678. |
| C27 | 10-08 night, v19 | Typed arrays and DataView keep JavaScript's semantics (stores wrap, reads are plain numbers). | **Claude's call, for the user to confirm.** The alternative (typed reads) would put scalars into case-1 programs. `DESIGN.md` "The rule". |
| C28 | 10-08 night | Bit functions (`wrappingAdd/Sub/Mul`, `leadingZeros`, `countOnes`, rotations, `swapBytes`, `reverseBits`) and `toBits`/`fromBits`, as library completeness (U36). | **Claude's call, for the user to confirm.** `wrappingMul` is what U52's lossy-operand rule points to (FNV). |
| C29 | 10-08 night | Conversions are imported from `"nts:scalars"`, never global. | **Claude's call, for the user to confirm.** Global values clashed with a script's own `const Int8` (audit B6). |
| C30 | 10-08 night, v19.1 | Inferred types are never slots: storage typed by inference holds what node holds (`const idx = count - 1` is -1); rounding into a receiver's type argument only where the receiver's type was written. | **Claude's call, for the user to confirm.** Considered and rejected: inferred variables as slots (throws where node computes -1 in a JS developer's code). |
| C31 | 10-08 night | A remainder whose divisor may be 0 keeps its kind (a claim; NaN is caught at the slot). | **Claude's call, for the user to confirm.** By U52's letter it would be Float64, refusing `const k: Uint32 = i % n`. |
| C32 | 10-08 night | `Math.round/floor/ceil/trunc` of a double is a plain number (an integer, checked where stored), not a Float64. | **Claude's call, for the user to confirm.** Otherwise `set_size(Math.round(w / 3), 480)`, the canonical fix, is refused. |
| C33 | 10-08 night | A literal with a fraction ranks like a plain number in overloads (prefers a double): Java's `append(0.5)` is `append(double)`. | **Claude's call.** Integer literals keep "the first that fits". |
| C34 | 10-08 night | A result of several kinds is the intersection of their own types, printed `Int16 & Uint16`. | **Claude's call** (audit F15: `Scalar<"A" \| "B">` read as either). |
| C35 | 10-08 night | The export rule (U59) is nts's build's, not the checker's; the tour shows refused exports as code nts refuses. | **Claude's call:** the checker cannot tell which module is the entry. |
| C36 | 10-08 night | Library additions: `Float80` (Zig's f80, x87 `long double`), `c_wint_t`; `AsNumber<T extends bigint>` takes a type, not a kind name; `windows-x64` became `windows-x64-gnu`, with `-msvc` and `windows-arm64` beside it. `c_long32`/`c_ulong32` kept, as tables. | **Claude's calls** under U36/U39/U57. |
| C37 | 10-08 night | `NSRange.location` is bound as an `NSUInteger` bigint, not `AsNumber`: `NSNotFound` is 2^63-1. | **Claude's call**; sentinels are listed open (`DESIGN.md` "Open"). |
| C38 | 10-08 night | A library without `targets` adds the native four when another library names targets (audit-14 finding 15). | **Claude's call.** |
| C39 | the v19 ledger audit | Float kinds have `round` in place of `wrap` (a float has no modulus); U32 said "on every scalar". | **Claude's call.** |
| C40 | v19 | TS99011 (a callback's arithmetic may abort) is a warning, not an error: the abort is the rule (U59), and the warning says where it can happen. | **Claude's call.** |
| C41 | v19 | A float `clamp` keeps ±Infinity and NaN, which are values of every float kind (`scalars.d.ts`, `FloatFunctions.clamp`). | **Claude's call.** |
| C42 | 10-08, with U62 | Written scalar slots should be strict too: nts inserts no check the program didn't write. To settle first: a store through a view that loses the width (`Int8[]` as `number[]`, U53) can't be proven where it happens, so that view is refused or keeps a run-time check. | **Claude's recommendation, open.** `DESIGN.md` "Where this goes in nts" §2. |
| C43 | 10-08, the ScriptC comparison | Claude's account of its own mistake: the range proofs were built into a forked type checker while nts's compiler already had a range analysis (`facts.rs`), so two engines would derive one fact. | **Accepted by the plan (U63):** the checker is frozen; its rules and algebra carry over as a spec and an oracle. |

---

## 3. Supersession chains

### Conversions

1. **v0** (`numbers.ts`, L3503): `i8(lit)`, `.wrap`, `.try`, `.clamp` and `.from`.
2. **L3616:** Claude proposed `Int32(x)` that throws, an `.is` guard, `.wrap` and `.clamp`, and dropping `.try` and `.from`. The user agreed "mostly", and doubted `.wrap`.
3. **L3639:** Claude proposed dropping `.wrap` for operator idioms. **The user refused (L3648): keep `.wrap`.**
4. **`DESIGN` v1** (L3997) had the full table. **`DESIGN` v2** (L4462) silently dropped `Int32(x)` and `.is`.
5. **L6699 to L6953:** "JS's own operators" entered the answer, the approved plan and the README, without a flag.
6. **v15 `DESIGN`** (L7627) removed `Int32.wrap` and `Uint8.clamp`.
7. **L8640:** the user decided on a checked `as`, and `.wrap`/`.clamp`/`.try` on every scalar.
8. **Now:** drafts only. `.is` was never restored.

### The slot rule

1. **L4012:** every typed variable is a slot, including `const c = a + b`.
2. **L4051:** only declared types are slots; the user was told.
3. **Plan L6700:** only *written* types are slots; approved.
4. **v15:** a float slot rounds, as an exception to "never changes a value"; the user was told at L7678.
5. **L8640:** `as` becomes a written slot. **PENDING.**

### Float32

1. **L4012:** strict (Claude's call under U23).
2. **L6655:** the user decided "accept every number".
3. **v13:** implemented as the type relation.
4. **v15:** moved to the slot. The user was told at L7678. Refusals in `satisfies` and inferred generics were told at L8617.

### Naming and encoding

1. **v0:** Rust names (`i32`, `u8`).
2. **L3616:** the typed-array names (agreed).
3. **v2 to v14:** `CNumber`/`CBig` with `__c_<kind>`.
4. **v15:** `Scalar<K>` and `AsNumber<K>` (U38).
5. **v17:** `Scalar<"Int8">` with `__Int8` (U40). This breaks C01's "unchanged" promise. Disclosed in the plan; `scalars.d.ts` still claims otherwise.

### `let` widening

1. **L6653:** Claude proposed it.
2. **L6655:** the user pushed back.
3. **Plan L6700:** dropped, and approved.
4. **v15:** `DESIGN` no longer says so.

### `Math` signatures

1. **L3616:** recommended.
2. **Plan L6700:** approved.
3. **L6987:** not built; the user was told.
4. **Open:** only `imul` and `fround` remain listed.

---

## 4. Decided or promised, not built: keep listed until done

Done at v19/v19.1 (2026-10-08): the checked `as` (U31, with advice instead of
TS2352's "convert to unknown"); `wrap`/`clamp`/`try`/`is` on every kind,
including the C types (U32, U48, U49; `clamp` rounds half to even); the plain
number guard (U48); Math (U51); the platform folders and case 5 (U45, U47); the
concept research (U46).

Still open:

1. **The runtime half in nts** (adoption work, in the order of `DESIGN.md`
   "Where this goes in nts"):
   - **strict calls** (U62): every number passed to C, Java or wasm proven by
     `facts.rs`, or a compile error; the facts strict needs (lengths, guards,
     masks, `Math.*`, a binding's return types); the refusal count on nts's
     examples as the instrument;
   - written scalar types as facts and obligations in `facts.rs`, and strict
     slots if C42 is accepted;
   - the slot checks (RangeError, TypeError) and float rounding at slots;
   - the storage rule (U53);
   - unset scalars (U54);
   - `AsNumber`'s check (U56);
   - `CBool`/`CEnum` (U58);
   - the export signatures and the abort on a throw across native frames (U59);
   - the new kinds (`int128`, `uint128`, `float16`, `float80`, `float128`, the
     C tables);
   - `nts:scalars` as intrinsics (U33);
   - `from_brand` reading `__<Name>` and the tables.
2. **The performance half:** using written widths for storage and registers
   (U26).
3. **Adoption:** the user is taking it to MainClaude (U63).
4. **The JVM unsigned fix**, before or with adoption (`JVM-UNSIGNED-BUG.md`).
5. **Undecided, listed in `DESIGN.md` "Open":** ranges and sentinels, string-length
   units, packaging, the float environment.
6. **Waiting for the user:** a smaller `nts:scalars` (`DESIGN.md` "Where this
   goes in nts" §4, which revisits U32/U48), and strict slots (C42). Every open
   question for adoption is in `QUESTIONS.md`.

## 5. The user's questions without a complete answer

- **L8677:** "Are there any more stuff that you may have missed?" Answered by
  `AUDIT-2026-10-08.md`: five passes, 60-odd findings, every one fixed, decided
  or listed.
- **L3598:** "I do not see any examples of usage of builtin Math.sqrt(...)".
  Answered by the tour since v19: `2-scalars-in-app.ts`'s clamp idiom,
  `checks.ts`, and the `ntsScalarsMath` baseline.

## 6. Out-of-date records outside the playground

- **`memory/scalar-types-experiment.md`:**
  - It still gives the encoding as `number & { readonly __c_<kind>?: true }` and the tour as `scalars.d.ts, bindings.d.ts, cases 1-4`.
  - It gives the slot rule without the float exception.
  - It calls "no jvm_*/wasm_*" the "User's call".
  - It does not mention U31 or U32.
- **`memory/an-audit-finds-what-it-is-pointed-at.md`:**
  - It says the user "had chosen to keep `.wrap`/`.clamp`/`.try`". In fact `.try` had been dropped at L3616 and came back only at L8640.
  - It dates the drop to v15 only. `Int32(x)` and `.is` were dropped at v2.
- **The plan file `prancy-questing-charm.md`:**
  - It calls v16 uncommitted (it is committed).
  - It has nothing on U31, U32 or U45.
