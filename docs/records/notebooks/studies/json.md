# JSON at simdjson's level in nts: the design

Written 2026-10-22 for the user and MainClaude. This is research and small experiments only; no
repository source was changed. Everything I ran is under `~/.cache/nts-scratch/json/`: sources in
`bench/` and `tools/`, logs in `build/`.

**Measured** means timed on this machine tonight: an i9-14900K (AVX2, no AVX-512), CPU 4 under
`tooling/gate/with-lock.sh --wait`, inside an 8 GB `systemd-run` cap, median of 9 samples of
about 150 ms each. **Estimated** means my arithmetic from those measurements and the cited
sources. Every number below says which it is.

---

## Scope (narrowed 2026-10-22, 03:40, by the user through MainClaude)

**Native C/LLVM first: vendored simdjson, typed `JSON.parse(...) as T`, and typed stringify.**

- **Primary:** §0–§6 and §8 cover that path, plus the one native A/B the narrowing allowed (§1.4).
- **Deferred to Appendix A:** the JVM, Wasm and simdjson-java material, kept because it was
  already measured.
- **Later stages of the native plan:** untyped parse, the callback forms and byte boundaries.

## 0. The answer in one page

**What simdjson-class JSON means for nts.** It is three different jobs, and they have different
ceilings:

| job | the bar tonight (measured, this machine) | what decides nts's number |
|---|---|---|
| `JSON.parse(text) as T`, typed | simdjson On-Demand into C++ structs | a parser the compiler generates for `T`, and the kernels it calls |
| `JSON.parse(text)`, untyped | simdjson DOM (which builds no objects) | the erased value representation, and allocation |
| `JSON.stringify(x)`, `x: T` known | simdjson `string_builder` from structs | a serializer the compiler generates for `T`, number formatting, escaping |

**The design, in four lines:**

1. **JSON is a builtin with one implementation per layer.** The compiler core owns the JSON
   *boundaries* (`JsonParse`, `JsonStringify`, from the provider manifest). It expands each one
   into ordinary HIR: a parser or serializer generated from the static type, so all four backends
   get it without a backend change. Small native **kernels** do the byte work: indexing, numbers,
   string scanning and escaping. They are C on native, Java on the JVM, and generated helpers on
   Wasm. The spec-heavy rest (reviver, replacer, `space`, `rawJSON`) stays in the existing
   TypeScript in `runtime/web-platform/src/json`.
2. **Typed is the primary path.** The untyped `JSON.parse` is the same generator, run on the
   recursive JSON type, with a new erased representation: scalars held immediately, objects
   sharing their key lists.
3. **Vendor simdjson for C/LLVM, and use only the part of it that is exact for `JSON.parse`: its
   stage 1.** That is the structural index, over UTF-8 bytes and ASCII strings.
   - **How it is reached:** a small C++ shim gives it a C ABI.
   - **What builds the result:** nts generates stage 2 for `T`, and the serializer.
   - **Which parts stay unused:** simdjson's DOM, On-Demand, number and string APIs. They break 7
     of 16 `JSON.parse` corners (measured), so nts never uses them as `JSON.parse`.
   - **Strings that are not ASCII** (Latin-1 or UTF-16, like twitter and citm) take nts's own
     stage-1 front end.
   - **The C++ runtime** links statically from the toolchain nts already drives: +0.6 MB per
     program (measured).
   - **Numbers:** vendor `zmij` (C, MIT) for formatting.
4. **`JSON.parse(text) as T` is a checked conversion.** A mismatch throws `TypeError` at the
   boundary, and a `SyntaxError` always wins over it. Key order and undeclared keys are kept
   exactly when the program can observe them, and only then.

**Recommendation per target:**

| target | parse kernels | stringify kernels | simdjson / simdjson-java |
|---|---|---|---|
| C, LLVM (in scope) | vendored simdjson stage 1 (run-time dispatched) for UTF-8 bytes and ASCII strings; nts's own front end for Latin-1/UTF-16 strings; nts-generated typed stage 2; Eisel–Lemire numbers | nts-generated serializer; SIMD escape-copy; vendored zmij | **simdjson: yes, stage 1 only**, through a C++ shim, linked statically. Also the C++ benchmark reference and the index oracle |
| JVM, Wasm (deferred, Appendix A) | — | — | simdjson-java: no (Java 24, incubator flag + stderr warning, x86 only, rejects integers into `double`: measured) |

The measured tables are in §1 (the native A/B in §1.4), the design in §2–§6, benchmarks in §7,
the staged plan with expected numbers in §8, risks in §9, and the decisions that need you in §10.

---

## 1. What was measured tonight

**Conditions.**

- **Machine and lock:** i9-14900K, CPU 4 with sibling 5 idle, under the quiet-core lock. Load
  average 22–44 on the other cores while gates ran. Memory cap 8 GB, admission at
  MemAvailable ≥ 14 GB.
- **Versions:** node 24.20.0, Bun 1.4.0, JDK 21.0.5 (Corretto) for nts's JVM output, JDK 27 for
  simdjson-java, clang 23.1.3, simdjson 5.0.2, yyjson 0.13.0, simdjson-java 0.4.0.
- **nts:** the pinned binary of `main` at 90e9c77c2. Since then `main` has changed only a
  generator refusal (`suspend.rs`). Provider `rc`, as every JSON row uses; `-O2 -flto`, as the
  bench builds.
- **Timing:** median of 9 samples of about 150 ms each, after a 2–3 s warm-up on the JITs. MB/s is
  the input size over the median, or the output size for stringify. Raw logs:
  `build/timed-batch-1.txt`, `timed-batch-2.txt`, `native-run1.txt`, `host-*-run1.txt`.
- **One caveat about the old rows:** the `node` and `bun` columns of the existing bench rows run
  *nts's TypeScript* on those engines, not their native `JSON`. The comparison the goal asks for
  is the second table.

### 1.1 Untyped parse, µs per document (measured)

| implementation | twitter 631,515 B | citm 1,727,204 B | canada 2,251,051 B |
|---|---:|---:|---:|
| simdjson 5.0.2 DOM, `-O3 -march=haswell` | **98** | **268** | **1,301** |
| — of which stage 1 alone (structural index) | 47 (55,263 entries) | 113 (135,990) | 198 (334,373) |
| simdjson DOM, baseline x86-64 build (run-time dispatch picks `haswell`) | 114 | 306 | 1,316 |
| yyjson 0.13.0 read (one pass, no SIMD) | 279 | 387 | 1,249 |
| simdjson-java 0.4.0 parse (JDK 27, 256-bit) | 464 | 1,156 | 3,912 |
| simdjson-java parse + walk every value | 846 | 1,529 | 4,758 |
| **node 24 `JSON.parse`** | **581** | **1,413** | **3,671** |
| **Bun 1.4 `JSON.parse`** | **489** | **1,296** | **4,067** |
| nts today, C (the TypeScript parser, `rc`) | 6,410 | 14,031 | 38,962 |
| nts today, JVM | 2,032 | 3,166 | 22,228 |
| node running nts's TypeScript parser | 2,154 | 4,240 | 14,017 |
| Bun running nts's TypeScript parser | 3,709 | 4,186 | 12,301 |
| C++→Wasm on node: simdjson DOM (it has no Wasm kernel, so `fallback`) | 494 | 894 | 2,971 |
| C++→Wasm on node: yyjson read | 169 | 454 | 1,651 |

**Read as ratios:**

- **nts C today against node's native parser:** 11.0× / 9.9× / 10.6× slower.
- **nts C today against simdjson's DOM:** 65× / 52× / 30× slower.
- **The JVM** is 3.5× / 2.2× / 6.1× slower than node.
- **simdjson's DOM against node:** 5.9× / 5.3× / 2.8× faster. That is the headroom.

### 1.2 Typed parse into structs, µs (measured)

| implementation | twitter (subset: 9 status + 9 user fields + hashtags) | citm (whole schema) | canada (whole schema) |
|---|---:|---:|---:|
| simdjson On-Demand into C++ structs, `-march=haswell` | **103** | **461** | **1,422** |
| the same, baseline build (On-Demand compiles to the **fallback** kernel without `-march`) | 121 | 479 | 1,401 |
| the same readers through an opaque `extern "C"` shim, one call per step (`bench/shim.cpp`) | — | 478 (+3.6%) | 1,726 (+21%) |
| simdjson-java schema mode (records) | 468 (with `long` ids: `double` ids fail) | 1,257 (performances only: no `Map`) | **fails**: integer literals in `double[]` |
| node / Bun (`JSON.parse` is their only form) | 581 / 489 | 1,413 / 1,296 | 3,671 / 4,067 |

**What this table says:**

- **Typed costs more than DOM in C++ too** (citm 461 against 268 µs). Building
  `std::vector`/`std::string` per object is the cost. Materialization, not scanning, is the floor
  of typed parse.
- **The per-field C boundary costs 4–21%.** It costs most where calls are densest: canada's 111,126
  numbers.

### 1.3 Stringify, µs (measured)

Outputs: 466,906 / 500,299 / 2,090,234 bytes; the twitter subset is 88 KB.

| implementation | twitter | twitter subset (typed) | citm | canada |
|---|---:|---:|---:|---:|
| simdjson `string_builder` from structs (typed) | — | **7.8** | **73.2** | **1,559** |
| simdjson DOM `to_string` | 328 | — | 355 | 2,335 |
| yyjson write | **98** | — | 146 | 1,410 |
| **node 24 `JSON.stringify`** | **973** | **93.6** | **1,061** | **7,390** |
| **Bun 1.4 `JSON.stringify`** | **197** | **31.5** | **1,245** | **4,118** |
| nts today, C (the TypeScript graph serializer) | 891 | — | 3,216 | 15,637 |
| nts today, JVM | 1,408 | — | 2,180 | 10,402 |
| node / Bun running nts's TypeScript serializer | 1,763 / 1,773 | — | 2,120 / 3,276 | 11,878 / 14,665 |
| C++→Wasm on node: yyjson write | 105 | — | 174 | 2,065 |

- **Already ahead of node:** nts C's graph serializer is ahead of node's native one on twitter
  (891 against 973 µs), before any of this design.
- **Where it loses:** on canada, at 2.1× node, the cost is number formatting (Grisu3 + `js_dtoa`
  fallback).
- **Output agreement:** the TypeScript serializer's output length equals node's on all three
  corpora, and the output equals `JSON.stringify(JSON.parse(text))` on every one (checked in
  `bench/host-ts.mjs`).

### 1.4 The native A/B: vendored stage 1 + a typed stage 2 in C, against simdjson's best (measured)

canada.json into typed objects. Both arms are in one lock session, back to back (`build/ab-canada.txt`).

| arm | what it is | µs | vs node (3,671) |
|---|---|---:|---|
| **A** | simdjson's stage 1 through the C shim (`sj_stage1`), then a typed stage 2 in plain C over the index (`bench/stage2.c`), compiled `-O2` with no `-march` as nts compiles generated C | **1,713** (rerun: 1,715) | **2.14×** faster |
| B | simdjson On-Demand inlined into C++ structs, `-O3 -march=haswell` | 1,256 | 2.92× |
| (ref) | simdjson DOM, same sitting | 1,202 | 3.05× |

**Arm A is shaped like nts output:**

- one 48-byte `NtsArray`-like header per point, plus exact-size arrays copied from a scratch stack;
- `malloc`'d objects and copied strings, with keys compared in place;
- the previous result freed every iteration, as RC would;
- numbers through simdjson's own parser, so both arms convert identically.

**It agrees with node exactly:** 55,563 points, coordinate sum −1265531.1088840018.

**Reading:**

- **The architecture holds up:** a generated stage 2 over a vendored index lands where §8
  estimated (1.7–1.9 ms), 2.1× ahead of node.
- **The 1.36× gap to arm B** is about the cost of 55,563 per-point allocations at ~8 ns each,
  against C++'s inline `std::array<double,2>`. That is a representation cost, not a scanning one.
- **The C boundary is cheap when it is crossed per document:** stage 1 is crossed once here, and
  the number parser once per number. Per-field On-Demand calls through a C ABI cost +3.6% (citm)
  to +21% (canada) (§1.2).

### 1.5 What feeding simdjson costs for a JS string (measured)

- **simdjson's stage 1 requires UTF-8.** As JavaScript strings, twitter (31,796 CJK units) and
  citm are **two-byte**. citm is two-byte because of exactly one character, U+0152 `Œ`, among
  1,727,030 units. Only canada is ASCII.
- **Transcoding is expensive:** V8's `TextEncoder.encodeInto` (node 24) took 397 µs for twitter,
  1,047 µs for citm and 103 µs for canada. For the two-byte ones that is 4× simdjson's entire
  parse of the same file, so transcoding to reach simdjson is not a path.
- **Lone surrogates** cannot be transcoded at all.
- **Hence the plan:** vendored stage 1 for bytes and ASCII strings, and nts's own front end for
  Latin-1/UTF-16 strings. The front end is the same algorithm with a `packus` input stage (§4.1).

### 1.6 What vendoring simdjson costs a C/LLVM program (measured)

- **Compile:** `simdjson.cpp` compiles in 11.3 s at `-O3 -fno-exceptions -DSIMDJSON_EXCEPTIONS=0`,
  to 369 KB of text for its four x86 kernels. It should be compiled once per target and cached, not
  per program.
- **Link:** it needs the C++ runtime even without exceptions and RTTI.
  - **Dynamically:** a dependency on `libstdc++.so.6` (Arch package `libstdc++`) on every machine
    the program runs on.
  - **Statically:** `-static-libstdc++ -Wl,--gc-sections` from `gcc`'s `libstdc++.a`, which is
    present because `clang` depends on `gcc`. The stripped A/B binary grows 260,680 → 859,400 bytes
    (+0.6 MB), with no new run-time dependency.
  - **Cross targets:** zig's bundled libc++ serves the same role.
- **Recommendation:** static, so nts-built programs keep depending on nothing a user must install.

### 1.7 Typed materialization with today's compiler and no kernels (measured)

A hand-written typed parser in TypeScript (`ntstyped/src/case.ts`), compiled by today's nts. It is
the parse-side twin of `json-stringify-fused`.

| document | nts C, typed TypeScript | nts C, today's generic parser | node `JSON.parse` | Bun | simdjson DOM |
|---|---:|---:|---:|---:|---:|
| `json-parse` row's 136,304-byte document | **361 µs** | 1,130 µs (bench row) | 398 µs | 293 µs | 68 µs |
| canada | 13,117 µs | 38,962 µs | 3,671 µs | 4,067 µs | 1,301 µs |

- **The typed shape alone is worth 3.1×**, and it already passes node's native parser on the
  record-shaped document.
- **On canada it is still 3.6× behind node,** because each number goes through
  `Number(s.slice(...))`: a substring allocation and `strtod`. That is what the number kernel (S1)
  and the generated plan remove.


---

## 2. Architecture: one builtin, three layers

### 2.1 Why the layers fall where they do

What the codebase says (cited from the compiler-core and backend reports, `main` at 5a2242da2):

- **`JSON` is not a builtin today.** `JSON.parse` is `NTS1001 a global member with no definition
  here`. The parser and serializer in `runtime/web-platform/src/json/` (2,266 lines of TypeScript)
  are reached only by importing them. test262's 159 `built-ins/JSON` files appear in no record on
  any backend (`results/test262/*/builtins.tsv` has no JSON row).
- **An opaque runtime helper would cost every typed field.** `exposure.rs:16-57` pins every field
  of a type reachable from an external call to `double`, and an `Erased` reachable that way exposes
  every type the program unerases into. So a `JSON.parse` that is a C function returning objects
  would stop integer narrowing program-wide. A parser generated as HIR does not.
- **`x as T` over `unknown` is unchecked today for structural `T`**
  (`lower/assertions.rs:226` → `Unerase`, emitted as `(T*)nts_value_reference(v)`). Primitives get
  a tag check and a `TypeError`. A JSON result asserted to an interface would therefore be
  memory-unsafe without this design.
- **Layouts:** an interface is a fixed C struct in declaration order, or written order where every
  literal agrees. An optional field is a 16-byte `NtsValue` plus a presence bit (26 bits at most).
  `string | null` is a nullable pointer. `Record<string,V>` is a `Table` (`NtsMap`). A `number`
  field narrows to `int32`/`int64` only when every writer is proved integral.
- **Strings** are flat: Latin-1 or UTF-16 units inline after a 24-byte header, with no slices or
  ropes. **Allocation** is a bump allocator under the default NoGc, and 16-byte size-class free
  lists under RC, which every JSON benchmark row uses.
- **No SIMD anywhere, and no `-march`:** x86-64 builds are SSE2 baseline. The LLVM backend calls
  `static inline` helpers through out-of-line `_fn` companions, which only `-flto` removes. The
  bench uses `-flto`; `nts build` does not.
- **JVM:** `java.lang.String`. The runtime is class version 52 (`javac --release 8`) and runs on
  JDK 21. A string literal past 65,535 bytes is declined (measured: `NTS4001` on twitter.json).
- **Wasm:** WasmGC, strings are `externref` through `wasm:js-string`, there is no linear memory,
  and v128 is used only for bigint.

### 2.2 The layers

```
            JSON.parse / JSON.stringify / Body.json() / Response.json()
                                  │  (provider manifest: boundary semantics)
                                  ▼
  L2  compiler core: hir/json/  ── the static type T at the boundary decides the plan
        • typed plan  (T is JSON-shaped)          → generated materializer / serializer, as HIR
        • generic plan (any, unknown, reviver…)   → the same generator over the recursive Json type
                                  │  calls
                                  ▼
  L0  kernels, per target (no JSON *semantics* beyond the lexical grammar)
        stage-1 index · string end/unescape/escape-copy · number parse · number format · UTF-8
        C: runtime/c/json/*  (static inline in the header where hot)
        JVM: nts.rt.json.*   (Java 8 API level)
        Wasm: generated module helpers (compiler/codegen/wasm/src/json.rs) + bound host formatter
                                  ▲
  L1  runtime/web-platform/src/json (TypeScript, compiled by nts like today)
        reviver + context.source, replacer, propertyList, space, rawJSON/isRawJSON,
        error-message text; operates on the erased values L2 produces
```

- **L2 holds the semantics that depend on types:** what a field accepts, required and optional
  fields, unions, key order, undeclared keys, and the shape of the output.
- **L1 holds the semantics that depend on callbacks:** the reviver, the replacer and `space`.
- **L0 holds only the lexical grammar:** what a number, a string or a structural character is.
- **No rule is written twice.** The one deliberate exception is the parse grammar: typed and
  generic plans both come from one generator, so it is written once there.

### 2.3 Why the generic parser is the generator too

The untyped `JSON.parse(text)` is `JSON.parse(text) as Json`, where `Json` is the closed recursive
type `null | boolean | number | string | Json[] | { [k: string]: Json }` mapped to the erased
representation (§4.2). Two consequences:

- **There is no second parser to keep in step.** The typed path and the generic path differ in
  their plan, not their code, so the differential test (§8, soundness) compares two plans from one
  generator.
- **The generic path compiles like hand-written C.** It is straight-line HIR calling inlined
  kernels, not TypeScript walking an erased graph through dynamic operations. That matters: tonight
  nts compiles the existing TypeScript parser at 121 MB/s where V8 runs the same source at
  241 MB/s (measured, the `json-parse` row's 136,304-byte document, 1.13 ms against 566 µs).

The TypeScript `parseJsonText` and the `JsonValue` class stop being the parse path. They stay only
as a host-side reference for the differential, or are deleted (stage S6 decides).

---

## 3. Typed parse: `JSON.parse(text) as T`

### 3.1 The forms that mean it

A `JsonParse` boundary is **typed** when its fresh result reaches one representation-determining
consumer of static type `T`, with no other use. That covers:

| form | `T` comes from |
|---|---|
| `JSON.parse(s) as T`, `<T>JSON.parse(s)`, `JSON.parse(s) as unknown as T` | the assertion |
| `const x: T = JSON.parse(s)`; `x = JSON.parse(s)` for a typed `x`; `this.f = JSON.parse(s)` | the declared type of the target |
| `return JSON.parse(s)` in a function returning `T` or `Promise<T>` | the return type |
| `f(JSON.parse(s))` where the parameter is `T` | the parameter type |
| `function load<T>(s: string): T { return JSON.parse(s); }` | each instantiation (nts monomorphizes) |
| `await res.json() as T`, `const x: T = await res.json()` | the same, through `Body.json()` (`JsonParseBytes`) |

- **Not typed:** a result kept as `any` or `unknown` and then used more than one way. Such a result
  takes the generic plan.
- **An `as T` over a generic result** that was already built is refused with a diagnostic.
  `any-unknown.md` forbids converting an existing native object silently, and parsing once per
  type is what the program should say.
- **A guard over an `unknown` result** (`if (isUser(v))`) stays generic. Fusing guards is listed
  as later work (§8, S10).

### 3.2 Which `T` are admissible (compile time)

`T` must be something `JSON.parse` can produce:

- **Accepted:** `string`, `number`, `boolean`, `null`; literal types and enums (checked against
  their set); arrays, readonly arrays and tuples (length checked); object types and interfaces
  without methods; optional properties; `Record<string,V>` and string index signatures; unions;
  `unknown`/`any` subtrees (generic plan below them); written scalar types (`Int32`, `Uint8`, …:
  integral and range checked).
- **Refused, with a diagnostic that names the fix:**
  - **classes**: JSON never produces an instance, and `instanceof` would disagree with node;
  - **`Date`, `Map`, `Set`, typed arrays, `bigint`, functions, symbols**: no JSON value is one;
  - **`undefined`-only types**: JSON has no `undefined`; an absence is an optional property.

### 3.3 The generated parser

One function per (layout, mode), not one per site. It is called from every boundary that needs
it, and the backend's own inliner decides about small ones. The plan for `T` is built from the
type graph:

```text
interface User { id: number; name: string; tags: string[]; email?: string; boss: User | null }

json$parse$User(cursor):                     // cursor = text, units width, stage-1 index, position
  expect '{'                                 // next structural from the index
  u = ObjectNew(User); seen = 0
  while member:
    k = key span [open+1, close)             // raw units; 'escaped' bit from stage 1
    slot = match(k)                          // (1) speculate: the field the last User had here
                                             // (2) else perfect hash on (length, first, last unit)
                                             //     → candidate → compare against the pre-quoted
                                             //       constant '"name":' (16/32-byte SIMD compare)
                                             // (3) an escaped key: unescape to scratch, then (2)
    switch slot:
      id:    number token  → u.id   = kernel_number(cursor)              (double, Eisel–Lemire)
      name:  string token  → u.name = kernel_string(cursor)              (copied once, exact size)
      tags:  '['           → u.tags = array of strings, exact size via the per-depth scratch
      email: string token  → u.email = string; presence |= bit(email)
      boss:  'null' → NULL;  '{' → push frame (User is recursive: explicit stack, §3.7)
      other: kernel_skip(cursor)                    // validates, allocates nothing
             (or capture as an undeclared key, §3.5)
      mismatch → §3.4
    if seen & bit(slot): release the earlier value  // duplicate: the last one wins
    seen |= bit(slot)
  required = {id, name, tags, boss}; if (seen & required) != required → TypeError (missing)
```

**Numbers** go straight to the field's representation:

- `double` for `number`;
- an integer slot for a written scalar type (`Int32`, `Uint32`, …), after the integrality and
  range check on the converted value, so `"1e2"` into `Int32` is 100 and accepted.
- A plain `number` field is never narrowed on speculation. The boundary writes arbitrary doubles,
  so `fields.rs` sees a non-integral writer and the field stays `double`, which is what JavaScript
  observes.
- The integer fast path is in the *parse*: up to 19 digits accumulate exactly, a value below 2^53
  with no fraction or exponent converts exactly, then the Clinger fast path, then Eisel–Lemire,
  then an exact fallback.

**Strings** are copied once, into an exact-size flat string:

- **The end** is found with a SIMD scan for `"` and `\`.
- **The copy** is then one `memcpy`.
- **Width:** Latin-1 stays one byte unless an escape produces a unit at 256 or above. A two-byte
  source narrows when every unit fits, which the scan learns for free.
- **No allocation at all** for keys, which are compared in place, and for skipped values.
- **No allocation for a literal-typed field** (`kind: "user" | "bot"`, a string enum). The check
  against the set already identifies the literal, so the field stores the interned literal itself
  (S10).
- **Views** into the input are *not* proposed (§6.1): they would not remove the allocation, and
  they would retain the input.

**Field liveness (On-Demand, statically).**

- A field of `T` that no reachable code reads, and whose object never reaches a key-observing or
  serializing operation, is parsed as *skip*: validated, never materialized. The layout can drop
  it.
- This is simdjson On-Demand's advantage obtained at compile time: the program says what it reads.

**Discriminated unions.**

- For `{kind:"a",…} | {kind:"b",…}`, the generated code finds `kind` with a lookahead over the
  object's index entries, without materializing anything, then runs that arm's parser. The
  discriminant may come last.
- Unions of JSON kinds (`string | number`, `T | null`) dispatch on the token.
- A union of object types with no discriminant tries each arm from the object's start (the index
  makes the retry cheap) and takes the first that matches.

### 3.4 Mismatch semantics (the decision §10.1 asks you to confirm)

**Recommended: a checked conversion.**

- **On a mismatch,** the materializer stops building. It validates the rest of the text with the
  generic skip.
- **Errors:**
  - **`SyntaxError`** if the text is not JSON, exactly as `JSON.parse` would throw. Invalid text
    always wins.
  - **Otherwise `TypeError`,** with a JSON path: `JSON.parse as User: $.rows[3].id: expected
    number, found string`.
- **What counts as a mismatch:**
  - a missing required property;
  - `null` for a non-nullable property;
  - a wrong JSON kind;
  - a literal or enum value outside its set;
  - a tuple of the wrong length;
  - a non-integral or out-of-range value for a written scalar type.
- **Why:** this is what `any-unknown.md` already specifies for a failed native check ("raises a
  `TypeError` through an available handler or raising entry"), and what `assertions.rs` does
  today for primitives.
- **What it costs in agreement with node:** it diverges from node only for programs whose `as T`
  was false, which TypeScript itself treats as a bug.
- **Alternatives, and why not:**
  - an *unchecked/trusted* mode is memory-unsafe with native layouts;
  - a *lenient* mode would make every field erased and lose the fast path;
  - a *compile error unless validated* would refuse the most common line of TypeScript JSON code
    there is.

### 3.5 What JavaScript observes that a struct does not: key order and undeclared keys

A struct has its declaration order and no room for extras. A JSON object has source order and
every key. Both differences are observable only through `Object.keys`/`entries`/`values`,
`for…in`, `JSON.stringify`, spread, `Object.assign`, and `in`/`hasOwn` on an undeclared name.
nts already orders own keys per layout (`lower.rs:4064`, array indices first, then written
order), so the rule extends it:

- **Unobserved** (the flow analysis finds none of those operations reachable from values
  materialized at this boundary): order and extras are dropped. This costs nothing and nothing can
  tell.
- **Observed: order.** The layout gains a hidden `json_order` pointer.
  - **It points to** an interned permutation of the declared keys in source order.
  - **It is null** when the source order is the layout order.
  - **The table is per boundary.** A document's rows nearly always share one order, so it holds
    one entry.
  - **Who reads it:** `Object.keys`, `for…in` and the serializer.
- **Observed: extras.** The layout gains a hidden `json_extra` slot. It holds a generic JSON
  object of the undeclared keys in source order, and `undefined` when there are none.
- **Until this is implemented (stage S7)**, a boundary whose results reach such an operation is
  *refused* by name, so no stage is unsound.

### 3.6 The other corners, fixed by the specification and not by `T`

| corner | rule (ECMA-262 25.5.2, pinned at `runtime/web-platform/third_party/ecma262/json-25.5.txt`) | typed | generic |
|---|---|---|---|
| duplicate keys | the last value wins, at the first key's position | field written twice; the earlier value released | shape keeps the first position |
| `__proto__` | an ordinary own data property (CreateDataProperty) | a field named `"__proto__"` if `T` declares one, else an undeclared key | ordinary key; JSON objects have no prototype mechanics |
| array-index keys | `OrdinaryOwnPropertyKeys`: indices ascending first; `"01"`, `"-1"`, `"4294967295"` are strings | through `json_order` | shape flag "has index keys" → ordered view (citm has them) |
| `-0` | `-0` | double `-0` | immediate `-0` |
| `1e400` | `Infinity` (valid JSON) | `Infinity` | `Infinity` |
| integers past 2^53 / 2^64 | rounded to nearest double | Eisel–Lemire, exact fallback | same |
| `"\ud800"` | a lone surrogate unit, kept | two-byte string holding it | same |
| control characters < 0x20 raw in a string | `SyntaxError` | stage 1 flags them | same |
| whitespace | only tab, LF, CR, space; U+FEFF is not | stage 1 | same |
| depth | node accepts at least 10^6 nested arrays | no recursion: non-recursive `T` is straight code; recursive `T` uses an explicit stack | explicit stack |

### 3.7 No recursion on the thread stack

The plan (§9 of the integration plan) forbids it, and it holds here without cost:

- **A non-recursive `T`** has a nesting depth fixed by its type, so the generated code is nested
  loops with no stack at all.
- **A recursive `T`** (and the generic `Json`) gets a generated state machine over an explicit
  stack of frames, each frame holding the object being built and the continuation within it.
- **The limit** is memory, and it is one documented value that is the same on every backend
  (§10.6).

---

## 4. Untyped parse at simdjson speed

### 4.1 Stage 1: a structural index over nts's own string forms

simdjson's stage 1 (Langdale & Lemire, VLDB J. 2019, §3.1) finds every structural character and
value start in 64-byte blocks:

- **Classification:** two `vpshufb` nibble lookups, ANDed.
- **Escapes:** odd-length backslash runs end in an escaped quote.
- **Quoted regions:** the in-string mask is the prefix-XOR of the unescaped quotes. That is
  `pclmulqdq` by all-ones, or a 6-step shift-XOR without CLMUL.
- **Errors:** unescaped control characters inside strings are flagged.
- **Output:** the set bits are flattened with `tzcnt` into an array of `uint32` positions.

For C/LLVM the stage-1 *kernel* is vendored simdjson's, wherever its input is valid UTF-8, and
nts's own front end handles the rest. Both produce one index format. By input:

| input | how stage 1 reads it | validation |
|---|---|---|
| one-byte string, all ASCII | **vendored simdjson stage 1**, directly on the units | its UTF-8 check passes trivially |
| one-byte string (Latin-1 units ≥ 0x80) | nts's front end: the bytes as they are, with units 0x80–0xFF as "other" | none needed: every byte is a unit |
| two-byte string (UTF-16 units) | nts's front end: 128 bytes per block, saturating `packus` to 64 bytes (a unit ≥ 0x100 packs to 0xFF, which is "other", since every structural character is ASCII) | none: lone surrogates are data |
| UTF-8 bytes (`Body.json()`, files, a fused `TextDecoder`) | **vendored simdjson stage 1** | its own UTF-8 validation (Keiser–Lemire). Invalid input takes the WHATWG decode-with-U+FFFD path, then parses the string, because `Body.json()` *replaces* rather than rejects |

- **Positions are unit offsets** in the string forms, so `context.source`, `rawJSON` spans and
  error positions need no mapping.
- **Dispatch:** AVX2+PCLMUL, SSE4.2+PCLMUL, NEON and a portable 64-bit SWAR kernel, chosen once
  by `__builtin_cpu_supports` behind `__attribute__((target(...)))` functions. nts keeps the SSE2
  baseline for everything else (§10.5).
- **Tail:** the tail block is copied into a padded scratch buffer, so no kernel reads past an
  allocation.
- **Memory:** 4 bytes per structural, in a per-thread scratch that is reused, grows on demand and
  is capped. Past the cap it runs in streaming chunks.

**Why an index rather than one pass (measured):**

| file | simdjson DOM (index, then tape) | yyjson (one pass) |
|---|---|---|
| twitter | 98 µs | 279 µs |
| citm | 268 µs | 387 µs |
| canada | 1,301 µs | 1,249 µs |

Both are built `-O3 -march=haswell`.

- **Where the index helps:** most on string-heavy text (2.8× on twitter). On canada, which is
  numbers, the one-pass parser is 4% faster.
- **What else needs it:** skipping, field liveness, discriminant lookahead and bracket matching,
  all of which the typed path relies on.

### 4.2 Stage 2: the erased JSON value, redesigned

Today a parsed value is a `JsonValue` object per node, scalars included: a 9-field class with
shared empty arrays. The redesign:

| JSON | representation | allocations |
|---|---|---|
| `null`, `true`/`false`, number | the 16-byte `NtsValue`, immediate | **0** |
| string | `NtsString`, copied once. Keys are interned per parse in a seeded hash table; short values (≤ 10 units, as V8 does) are interned too | 1 per distinct string |
| array | `NtsArray` of `NtsValue` (`NTS_ARRAY_VALUE`), exact size: elements accumulate on a per-depth scratch stack and are copied once at `]` | 1 |
| object | **`NtsJsonObject`**: header, `const NtsShape *shape`, count, `NtsValue values[]` inline; built exact-size from the same scratch | 1 |

**`NtsShape`** is an interned, immutable key list, per parse.

- **Shared:** every row of an array of records shares one shape (the existing parser's "template"
  idea, made structural).
- **Flags:** "has index-like keys", which gives the ordered view of §3.6, and "every key needs no
  escape", which the serializer reads.
- **Hash index:** built lazily only for wide shapes (≥ 16 keys, the threshold `value.ts` already
  measured).
- **Mutation:** a parsed object is an ordinary mutable object. A write of a new key, or a delete,
  moves that object to a private dictionary shape (copy on write). Readers never see shared state
  change.

**Property access** `data.rows[0].name` on a JSON-provenance `any`:

- **The trust argument:** the `JsonParse` boundary is trusted metadata (`any-unknown.md`,
  "Trusted boundary semantics"). Its `any` is therefore not unknown: it is one of six JSON kinds,
  and property access is a keyed lookup.
- **Each access site** gets a one-entry inline cache (shape pointer → slot).
- **This is the only dynamic property access** the design introduces, and it is confined to
  JSON-provenance values.

**Ownership under RC:** the builder *moves* each fresh child into its parent slot, with no
retain/release pair. That pair is the pattern that turned 4,002 cycle candidates into 14,009 per
parse (`docs/agents/lessons/memory.md`). A parse result is a tree, so releasing it reaches zero
everywhere and buffers nothing.

### 4.3 Where the reviver, `context.source` and `rawJSON` fit

- **A reviver** forces the generic plan and runs L1's `internalize` (TypeScript, as today) over
  the erased values. Each primitive keeps its source span, so `context.source` is exact.
- **`JSON.rawJSON`** validates with the same kernels and produces a raw node.
- **`as T` with a reviver** is generic-then-refused (§3.1). The reviver can change any value, so
  no typed plan applies.

---

## 5. Stringify

### 5.1 Typed: `JSON.stringify(x)` with `x: T`

A serializer per layout, generated as HIR. The previous JSON lane measured the hand-written
equivalent at 5.8× over the graph route and ahead of node's built-in (`json-stringify-fused`,
`JSON-HANDOFF.md`). The generator makes that the compiled default:

- **Keys are constants.** Each run of punctuation and keys between two values is one pre-quoted
  constant written with a fixed-size copy: `{"id":`, `,"name":`.
  - **Order:** array-index keys first, as `arrayIndexOf` defines them, then written order, or the
    `json_order` permutation when the object came from JSON with a different order.
  - **No escape scan.** The constants are escaped at compile time.
- **Numbers:**
  - an integer slot → `u32/u64` to decimal, two digits at a time;
  - a `double` → "integral and below 2^53 → integer path" (4.6–9× in ClickHouse, per the string
    survey), else zmij shortest digits, laid out to ECMAScript's rules;
  - `NaN`/`±Infinity` → `null`; `-0` → `0`.
- **Strings:** one pass that copies in 16/32-byte blocks while OR-ing the masks for `"`, `\` and
  < 0x20, plus unpaired surrogates on two-byte strings. On a hit it emits the escape and resumes
  SIMD at the next unit: the segmented form that took Bun's 210 KB-string case from 523 to
  45.6 µs (oven-sh/WebKit#250).
  - A string whose header says *escape-free* (§6.1) is a plain copy.
- **Absences:**
  - an optional property whose presence bit is clear is omitted;
  - an `undefined` value is omitted in an object and becomes `null` in an array;
  - functions and symbols likewise.
- **`toJSON`** is resolved statically per layout. `Date` writes `toISOString`. A class with
  `toJSON` calls it. The whole-program view knows which layouts reach the site, so there is no
  per-object lookup.
- **Cycles** need a check exactly when the type graph from `T` is recursive. Then the serializer
  keeps an explicit stack of open objects: a linear scan to depth 32, a hash set beyond. A
  non-recursive `T` pays nothing.
- **BigInt** → `TypeError`. Accessors on object literals are called; class prototype getters are
  not own properties and are skipped. `Map`/`Set` → `{}`. Typed arrays → index-keyed objects.
  All of this is as specified.
- **`space`:** the generator emits a second, indented variant taking the gap and depth, chosen
  when `space` is not statically empty. JSC measured 3.95× for supporting `space` in its fast path.
- **A replacer function or a property list** takes L1's generic serializer. It reads typed objects
  through a per-layout JSON descriptor (pre-quoted names, kinds, offsets) that the compiler emits
  beside the `NtsDescriptor`.
- **Through an erased slot:** a typed object reaching stringify that way is serialized through a
  new `NtsDescriptor.json_write` entry, the same mechanism as `to_string` for `String(o)`.

**The output buffer:**

- **One growing buffer, written once, adopted as the result string** (the `NTS_GROWN` capacity
  rule already allows slack). It starts in a stack buffer and moves to the heap once.
- **Width:** it starts one byte per unit and widens once, on the first two-byte string.
- **Size hint:** a per-site hint keeps the previous output size, so a loop serializing similar
  values allocates once.

**Writing into the consumer's buffer:**

- **JVM:** `out += JSON.stringify(x)`, where `out` is only appended to, becomes `json$write$T(out,
  x)` into the `StringBuilder`. This reuses the JVM lane's `hir::appended_results`
  (`jvm/appended-results`, WIP, `ReturnedString::Accumulated`). The C backend gets the same
  `_into` variant over `nts_str_append`.
- **Byte sinks:** where the result flows only into a UTF-8 byte sink (`Response` body,
  `fs.writeFile`, `TextEncoder.encode`, a socket), the serializer writes UTF-8 straight into the
  sink's buffer and the JS string never exists. Latin-1 units at or above 0x80 become two bytes;
  ASCII is a copy.

### 5.2 Untyped: `JSON.stringify(v)` over the erased graph

- **The same generator, over `Json`:** it switches on the tag, writes an array as a loop over
  `NtsValue`, and an object as a loop over its shape's keys and inline values.
- **Keys:** a shape whose keys all need no escape (one flag, as V8's "fast-json-iterable") writes
  them pre-quoted. The quoted forms are cached on the shape the first time.
- **Strings parsed from JSON** carry the *escape-free* header bit when their source span had no
  escape, quote or control character, so re-serializing parsed data copies them.

---

## 6. Representation changes, and the reason for each

You said the string, object and number representations may be rewritten. This is what the JSON
design needs from them, and what it deliberately does not need.

### 6.1 Strings

- **Keep the flat one-byte/two-byte string.** It is what V8, JSC and HotSpot converged on, and the
  string survey (`~/.cache/nts-scratch/strings-audit/state-of-the-art.md`, §1.3) recommends it.
- **Add header facts in `flags`.** Strings use none of the 26 presence bits objects use, so the
  room is there:
  - **`ASCII`:** UTF-8 output is a copy;
  - **`ESCAPE_FREE`:** no `"`, `\`, control character or unpaired surrogate, so JSON output is a
    copy;
  - **`WELL_FORMED`:** shared with `String.prototype.isWellFormed`.
  - **Optional facts:** set where a producer knows for free (a literal at compile time, the JSON
    parser, number-to-string, a concatenation of two flagged strings), and never required: an
    unset bit means "unknown".
- **No string views or slices.** A view would not remove the allocation, since a `string` field
  still needs an object to point at; it would add a branch to every string read, and it would keep
  the whole input alive from one small field. Copying a short JSON string is one `memcpy` after an
  allocation that must happen anyway. If a row ever shows otherwise, V8's rule (slices only at 13+
  units) is the precedent to measure against.

### 6.2 Objects

- **Typed objects stay structs.** The JSON boundary adds only the two hidden slots of §3.5, and
  only when the program observes what they carry.
- **Generic JSON objects become `NtsJsonObject` with `NtsShape`** (§4.2): one allocation per
  object instead of the `JsonValue`'s node plus its arrays, keys shared, values inline.
- **The same structure could replace `NtsMap` as the representation of `Record<string,V>`.** That
  is a separate decision (§10.8). JSON does not need it, but the ordered-keys rule (index-like keys
  first) is owed by `Record` too, and citm's numeric keys will test it.

### 6.3 Numbers

- **Formatting:** replace Grisu3 + `js_dtoa` (87 ns class, per the survey) with **zmij**:
  6.45 ns on an M1 Pro (survey, [M]), MIT, with a C implementation (`zmij.c`, `zmij-c.h`, v1.2).
  - **How it is vendored:** unmodified under `runtime/c/zmij/`, exactly as `runtime/c/quickjs/`
    is, with `REVISION` and `LICENSE`.
  - **Layout:** nts's own ECMAScript layout over zmij's shortest digits. JSC did the same on
    2026-10-20, with fix-ups where zmij's layout differs.
  - **One formatter:** this is the one `Number::toString` the integration plan requires, so
    `String(x)` and JSON share it.
- **Parsing:** replace `strtod` on the hot path with **Eisel–Lemire** (Lemire, SPE 2021: 45 M
  floats/s against `strtod`'s 9 M on Skylake).
  - **It is nts C**, written from the paper with `fast_float` (Apache/MIT/BSL) as the reference.
  - **Fallback:** `strtod` stays for the rare cases the algorithm cannot decide. It is libc, so no
    new dependency.
  - **Shared** with `Number(string)` and `parseFloat`.
- **JVM:**
  - **Parsing:** a Java port of the same parser. Java 8 has no `Math.multiplyHigh`, so the
    128-bit product is split by hand, as `NtsGrisu` already does.
  - **Formatting:** a Java port of zmij. Java's `Double.toString` cannot be used: it differs from
    JavaScript, and it is not shortest on JDKs before 19.
- **Wasm on a JS host:** formatting stays on V8's own formatter, through the bound
  `Number.prototype.toString` that V8 calls as a builtin (lesson: 49.5% fewer instructions).
  Parsing gets a generated Eisel–Lemire helper, to keep host calls out of the number loop (lesson:
  a call in a Wasm hot loop costs every iteration).
- **Standalone Wasm:** there is no host formatter, so it gets a generated zmij port, the same
  algorithm the C runtime vendors.

### 6.4 The kernels per target (the JVM and Wasm columns are deferred, Appendix A)

| kernel | C/LLVM | JVM (Java 8 API) | Wasm |
|---|---|---|---|
| stage-1 index | AVX2/SSE4.2/NEON/SWAR, run-time dispatch | SWAR over `byte[]` (UTF-8 input) or `String.charAt` with a class table (string input) | scalar over a GC `i16` copy (`intoCharCodeArray`); SIMD128 over a linear-memory copy if it measures better (S8) |
| string end / unescape | SIMD scan + `memcpy` | `String.indexOf('"' / '\\')` (vectorized HotSpot intrinsics on compact strings) | `wasm:js-string.substring(text, s, e)` for escape-free spans (no copy in Wasm); `fromCharCodeArray` for unescaped |
| escape-copy | SIMD, segmented | char loop + table; `StringBuilder` | GC array builder |
| number parse | Eisel–Lemire (nts C) | port | generated helper |
| number format | zmij (vendored C) | zmij port | bound host `toString` on a JS host; a generated zmij port standalone |
| UTF-8 validate/transcode | Keiser–Lemire; transcoding shared with `TextDecoder` | JDK `new String(bytes, UTF_8)` | `wasm:text-decoder` builtins / host |

- **Inlining:** the hot C kernels are `static inline` in `nts_runtime.h`, with the usual `_fn`
  companions. LLVM-backend programs therefore need `-flto` to inline them (§10.7).
- **The five-table checklist:** every kernel owes its row in each of the five tables at the top of
  the helper block.
- **Emitted only when used:** the JSON kernel translation unit is emitted only for programs that
  use JSON, as `libunicode.c` is for case conversion.

### 6.5 simdjson and simdjson-java as dependencies: verified (simdjson: stage 1 only; simdjson-java: no)

**simdjson v5.0.2 (C++).** Measured unless marked.

- **Licence:** Apache-2.0 *or* MIT (`LICENSE`, `LICENSE-MIT`). Bundled Dragonbox is
  Apache-2.0-with-LLVM-exception or Boost, per the README.
- **It builds** as the amalgamation with clang 23 and `-fno-exceptions -DSIMDJSON_EXCEPTIONS=0`:
  - 11.3 s for `simdjson.cpp` at `-O3`, 14.7 s with exceptions;
  - 369 KB of text for four x86 kernels (icelake, haswell, westmere, fallback).
- **It still needs a C++ runtime at link,** even with `-fno-rtti` as well:
  - `operator new/delete`, `__cxa_guard_acquire/release`, `__cxa_pure_virtual`,
    `std::__throw_logic_error`, `std::ios_base_library_init`,
    `std::__cxx11::basic_string::_M_create`;
  - that is libstdc++ or libc++, a system package on Linux. `runtime/c/quickjs/README.md` rejected
    ICU for exactly this ("every compiled program would pull in libstdc++");
  - shimming `basic_string::_M_create` by hand would be a hack.
- **It disagrees with `JSON.parse` on 7 of the 16 corners I probed** (`build/semantics`):

| input | `JSON.parse` | simdjson DOM | simdjson On-Demand | yyjson |
|---|---|---|---|---|
| `"\ud800"`, `"\udc00"` | lone unit | `STRING_ERROR` | `STRING_ERROR`, or U+FFFD with `allow_replacement` | error |
| `1e400` | `Infinity` | `NUMBER_ERROR` | `NUMBER_ERROR` | error |
| raw Latin-1 byte `0xE9`, or `0xFF` | (a JS string has no bytes; the UTF-8 form is valid text) | `UTF8_ERROR` | `UTF8_ERROR` | error |
| `18446744073709551616`, 30-digit integer | rounded double | `BIGINT_ERROR` (whole parse fails) | `get_double` works | ok |
| `-0` | `-0` | stored as int64 `0` (sign lost) | `-0` | `0` |
| `{"a":1,"a":2}`, read `a` | `2` | both kept | `["a"]` returns **1** | both kept |
| 10,000 nested arrays | fine | `DEPTH_ERROR` (default 1024) | ok | ok |

- **So only stage 1 is semantics-neutral.** Reaching it alone means simdjson's internal
  `internal::dom_parser_implementation::stage1` (it works: `bench/shim.cpp`), an API with no
  stability promise.
- **Stage 1 enforces UTF-8.** nts strings are Latin-1 or UTF-16, possibly with lone surrogates, so
  every parse would first transcode to UTF-8 (an extra pass, lossy for lone surrogates).
- **Kernels:** there is no Wasm kernel. A wasm32-wasip1 build reports `fallback` (measured). The
  library does not reach the JVM at all.
- **Across a C boundary:** calling On-Demand per field from generated code costs what §1.4
  measures.
- **Recommendation, as narrowed (vendored simdjson for C/LLVM):**
  - **Vendor it unmodified** under `third_party/simdjson` (v5.0.2 amalgamation, `LICENSE`,
    `LICENSE-MIT`, `REVISION`).
  - **Reach it from one C++ shim**, `runtime/c/json/nts_simdjson.cpp`, which exposes a C ABI. The
    working prototype is `bench/shim.cpp`. The shim exposes:
    - `stage1(units, length)` → structural index, through
      `internal::dom_parser_implementation::stage1`, with the run-time-dispatched kernel;
    - nothing else on the `JSON.parse` path.
  - **Stability:** that internal API has no stability promise, so the pin is exact, and an upgrade
    reruns the index-oracle differential of S3.
  - **Where it is used:** UTF-8 bytes (`JsonParseBytes`, S6) and one-byte strings that are all
    ASCII. The `ASCII` header fact (§6.1), or a 30+ GB/s SIMD check, says which.
  - **Every other string** goes through nts's own stage-1 front end: Latin-1 or UTF-16, with
    `packus`. That is the same algorithm, so the same index format feeds the same generated
    stage 2.
  - **Build and link:** compiled once per target and cached, and linked with the static C++
    runtime (§1.6).
  - **Also** the C++ benchmark reference (`ref.cpp`) and the oracle that checks nts's own front
    end produces the same index.
  - **Never used for `JSON.parse`:** its DOM, On-Demand, number or string-unescape APIs (the
    7-corner table above).

**simdjson-java 0.4.0** (Maven Central, sha1-checked). Measured unless marked.

- **Licence:** Apache-2.0.
- **Maturity:** 0.x; 0.1.0 through 0.4.0, the last published 2025-09-15.
- **JDK:**
  - its classes are **version 68, Java 24**; 0.3.0 is version 62, Java 18;
  - it needs `--add-modules jdk.incubator.vector` at compile and run time, and the JVM then prints
    `WARNING: Using incubator modules: jdk.incubator.vector` on **stderr**, which would break every
    nts program whose stderr is compared;
  - the Vector API is still incubating in JDK 27 (JEP 537) until Valhalla.
- **CPU:** it accepts only 256- and 512-bit species (`VectorUtils.assertSupportForSpecies`), so
  128-bit NEON (Apple, most ARM) throws `Unsupported vector species`. Android's ART has no Vector
  API.
- **nts's JVM runtime** is Java 8 class files (`--release 8`) with an Android floor of API 29. It
  cannot depend on a Java 24 jar.
- **API:**
  - `parse(byte[], len)` returns a `JsonValue` tape;
  - `parse(byte[], len, Class)` binds records or single-constructor classes reflectively, with
    `List` but **no `Map`**, so citm's string-keyed members cannot be expressed;
  - it **rejects an integer literal bound to a `double` component** (measured: twitter's `id`, and
    canada's 46 integer coordinates, fail with "Invalid floating-point number. Fraction or exponent
    part is missing.");
  - it rejects lone-surrogate escapes (source: `StringParser.java:54`, `:114`).
- **Recommendation:** the JVM reference column for SIMD parsing (§7), not a dependency.
  - 0.3.0 can run on the harness's JDK 21 with `--add-modules`;
  - the typed JVM reference is better DSL-JSON (BSD-3, Java 8, compile-time code generation), the
    nearest analogue of what nts generates.

### 6.6 What the compiler must expose

The general mechanism, which declares builtins per target in a provider manifest, is another
agent's design. JSON needs only these from it, and this is how JSON fits:

1. **Boundary semantics on declarations, not names.**
   - The manifest associates the standard declarations with a small closed set of core semantics:
     - `JSON.parse` → `JsonParse { text: 0, reviver: 1 }`;
     - `Body.json()` / `Request.json()` / `Response.json()` (instance) → `JsonParseBytes`, async;
     - `JSON.stringify` → `JsonStringify { value: 0, replacer: 1, space: 2 }`;
     - `Response.json(data)` (static) → `JsonStringify` into a body.
   - The core matches the semantic, never the name (`any-unknown.md`, "Trusted boundary
     semantics"). The same manifest row names L1's TypeScript functions as the generic
     implementation, so `JSON.parse` stops being `NTS1001`.
2. **One core op per direction, expanded in the core.**
   - **The ops:** `OpKind::JsonMaterialize { input, plan }` and
     `OpKind::JsonSerialize { value, plan, gap, sink }`.
   - **The plan** is a compiler-built table: fields, key constants, perfect-hash parameters,
     required mask, order and extras capture flags, field liveness, and whether the type graph is
     recursive.
   - **Expansion:** `hir::json::expand` turns each op into ordinary HIR (loops, kernel calls,
     `ObjectNew`, field sets) before backend preparation. No backend ever sees the op, so the
     `_ =>` audit stays inside `compiler/core`.
3. **Kernel helpers registered like every runtime helper.** The checklist at the top of the
   helper block in `nts_runtime.h` lists five tables: LLVM signatures, `ERASES_CLASS`,
   `READS_ONLY`, JVM `external`, and the Wasm catalog. The JSON kernels add a family of about 15.
4. **Two descriptor entries.**
   - **`json_write`** serializes a typed object reached through an erased slot, as `to_string`
     does for `String(o)`.
   - **The JSON field table** (pre-quoted names, kinds, offsets) is what L1's replacer path reads.
5. **Diagnostics:**
   - inadmissible `T` (§3.2);
   - a typed boundary whose results reach order or extras observers, until S7;
   - `as T` over an already-built generic result.

The **appended-results** analysis (`jvm/appended-results`, WIP) is reused, not redone. Its
`ReturnedString::Accumulated` answer is what selects `json$write$T(into)` over `json$string$T()`.

---

## 7. Benchmarks that prove it

### 7.1 The corpora, and their licences

| file | bytes | origin (nativejson-benchmark README) | licence |
|---|---:|---|---|
| `twitter.json` | 631,515 | Twitter search API results for 一 (CJK) | **unstated** |
| `citm_catalog.json` | 1,727,204 | a Java JSON-parser benchmark file (RichardHightower/json-parsers-benchmark) | **unstated** |
| `canada.json` | 2,251,051 | the contour of Canada's border as GeoJSON (mloskot/json_benchmark) | **unstated** |

- **Where they live:** today in `simdjson/simdjson` `jsonexamples/` (twitter, citm) and
  `simdjson/simdjson-data` (canada). Their SHA-256s are in `build/` of the scratch directory.
- **Licence:** nativejson-benchmark's code is MIT, but none of the three repositories states a
  licence for the data, and simdjson-data's README says "check individual files".
- **Recommendation:** do not check them in. Fetch them by pinned commit and SHA-256 into an
  untracked `third_party/simdjson-data`, the way `third_party/test262` and `third_party/node` are
  untracked clones (§10.4).
- **Conformance corpora:** JSONTestSuite (nst/JSONTestSuite, **MIT**) and simdjson-data's
  `jsonchecker` files are the parse-conformance corpora. JSONTestSuite's `y_`/`n_`/`i_` cases are
  the fixture inputs for §8.

### 7.2 Harness support the cases need

- **Data files.** The harness cannot read files at run time, and the JVM declines a literal past
  65,535 bytes. The case should therefore declare `data/<name>.json`, and the harness generate a
  module of ≤16k-unit literals joined at module scope.
  - **Measured:** it works on C and JVM; `tools/gen-today-chunked.mjs` is the prototype.
  - **Split points:** they must not fall inside a surrogate pair.
- **Host columns.** Once `JSON.parse` is a global, the `node` and `bun` columns of a case that
  calls it run **the engines' native JSON**, which is the comparison the goal asks for. The
  existing nine `json-*` rows keep measuring nts compiling the TypeScript library, and keep their
  meaning.
- **References.**
  - **`ref.cpp`** uses simdjson from the vendored `third_party/simdjson`, compiled at
    `-O3 -march=haswell`. **This matters:** On-Demand compiles to the *fallback* kernel without a
    `-march` (measured: `builtin fallback`), and the DOM uses run-time dispatch. A yyjson column
    belongs in a side script, as `json-stringify-doc/native.mjs` is.
  - **`ref.java`** uses DSL-JSON for typed rows and simdjson-java 0.3.0 for untyped rows. That
    needs `--add-modules` in the harness's `javac`/`java` lines for that case only.
  - **`C++ (wasm)`** is the same `ref.cpp` built for wasm32-wasip1, a build that already exists.

### 7.3 The cases

Twelve new cases, three corpora × four jobs. Each `case.ts` exports `work(n)` and returns a
checksum that reads every materialized field (so field liveness keeps all of them; one `subset`
variant reads a few and proves the skipping).

| case | `case.ts` | `ref.cpp` | `ref.java` |
|---|---|---|---|
| `json-{twitter,citm,canada}-parse-any` | `const v: unknown = JSON.parse(TEXT)`, walk and count | simdjson DOM parse + walk | simdjson-java 0.3.0 parse + walk |
| `json-{twitter,citm,canada}-parse-typed` | `JSON.parse(TEXT) as Twitter` (subset), `as Catalog` (whole schema), `as FeatureCollection` (whole schema) | simdjson On-Demand into structs (`bench/native.cpp` has all three) | DSL-JSON generated converters |
| `json-{twitter,citm,canada}-stringify-any` | `JSON.stringify(parsedOnce)` | `simdjson::to_string(dom)` | simdjson-java has no writer: DSL-JSON from `Map`/`List` |
| `json-{twitter,citm,canada}-stringify-typed` | `JSON.stringify(typedOnce)` | `string_builder` from structs (`bench/native.cpp`) | DSL-JSON writer |

The checksum of a stringify row is the output's UTF-16 length, which must equal node's. Measured
tonight: 403,318 / 500,125 / 2,090,234 units, and the TypeScript serializer agrees on all three.

---

## 8. The staged plan

**The rules of the plan:**

- **Smallest landing first.**
- **Every stage is sound on its own.** What it cannot do yet, it refuses by name.
- **Order in the narrowed scope:** S0 → S1 → S2 (typed stringify) → S3 (typed parse) → S4 →
  S7 (key order and undeclared keys).
  - **S3 uses the vendored stage 1 from its first landing** on ASCII strings and UTF-8 bytes.
  - **S5, S6 and S9** (untyped, callbacks, bytes) come after.
  - **S8** (JVM, Wasm) is deferred, see Appendix A.
- **Backends:** stages land on C and LLVM.
  - **JVM and Wasm:** the generator emits HIR, so they would compile the same plans, but until
    their kernels exist they refuse the JSON boundaries by name rather than run a slow path
    silently.
  - **LLVM** needs `-flto` to inline the kernels (§10.7).
- **SIMD tiers are an acceleration**, never the first availability.

**How to read the numbers:**

- the *today* and *bar* columns are **measured** (§1);
- the *expected* column is **estimated**, with its basis in the note under each table;
- ratios are against the native host engine on the same row, so `node 3.2×` means 3.2 times
  faster than node's own `JSON`.

### Where the plan ends up (C backend after S7)

The node, Bun and bar columns are measured. The nts column is estimated, with the basis under each
stage below. Ratios are of time; above 1 means nts is faster.

| row | node | Bun | bar (simdjson) | nts expected | vs node | vs Bun | vs the bar |
|---|---:|---:|---:|---:|---|---|---|
| parse typed, twitter subset | 581 µs | 489 | 103 (On-Demand) | 125–160 | 3.6–4.6× | 3.1–3.9× | 0.64–0.82 |
| parse typed, citm | 1,413 | 1,296 | 461 | 520–600 | 2.4–2.7× | 2.2–2.5× | 0.77–0.89 |
| parse typed, canada | 3,671 | 4,067 | 1,422 | 1,700–1,900 | 1.9–2.2× | 2.1–2.4× | 0.75–0.84 |
| parse any, twitter | 581 | 489 | 98 (DOM) | 220–320 | 1.8–2.6× | 1.5–2.2× | 0.31–0.45 |
| parse any, citm | 1,413 | 1,296 | 268 | 580–760 | 1.9–2.4× | 1.7–2.2× | 0.35–0.46 |
| parse any, canada | 3,671 | 4,067 | 1,301 | 1,800–2,300 | 1.6–2.0× | 1.8–2.3× | 0.57–0.72 |
| stringify typed, twitter subset | 93.6 | 31.5 | 7.8 (builder) | 12–25 | 3.7–7.8× | 1.3–2.6× | 0.31–0.65 |
| stringify typed, citm | 1,061 | 1,245 | 73.2 | 80–130 | 8–13× | 9.6–15.6× | 0.56–0.92 |
| stringify typed, canada | 7,390 | 4,118 | 1,559 | 1,000–1,500 | 4.9–7.4× | 2.7–4.1× | 1.04–1.56 |
| stringify any, twitter | 973 | 197 | 98 (yyjson) | 110–180 | 5.4–8.8× | 1.1–1.8× | 0.54–0.89 |
| stringify any, citm | 1,061 | 1,245 | 146 | 150–250 | 4.2–7× | 5–8.3× | 0.58–0.97 |
| stringify any, canada | 7,390 | 4,118 | 1,410 | 1,100–1,600 | 4.6–6.7× | 2.6–3.7× | 0.88–1.28 |

**Read plainly:**

- **The margins:** typed parse and every stringify row beat node and Bun by a wide margin.
- **The narrowest rows** are untyped parse (1.5–2.7×) and canada, which is numbers and two-element
  arrays.
- **Why untyped parse cannot reach simdjson:** a JavaScript `JSON.parse` must build objects, which
  simdjson's DOM does not.
- **Where the bar is met:** typed citm parse and canada stringify are at or past the C++ bar.

### S0: instruments (no compiler change)

- **Vendored:** `third_party/simdjson` (v5.0.2), DSL-JSON and simdjson-java 0.3.0 for references.
- **Fetched:** the corpora and JSONTestSuite by pinned hash.
- **Harness:** data-file support (§7.2).
- **Cases:** the twelve cases of §7.3. Their `nts` cells say "refused" until JSON is a global,
  which is the honest state. Their refs and node/Bun cells exist from day one.
- **Acceptance:** every ref's checksum equals node's on the same case.

**Rows:** the twelve new rows, with today's nts state recorded (for the parse rows,
`JSON.parse` refused, and the TypeScript library measured in §1).

### S1: number kernels (shared with all of JavaScript, not only JSON)

- **Formatting:** zmij vendored in `runtime/c/zmij/`, with nts's ECMAScript layout over it,
  replaces Grisu3 + `js_dtoa` in `nts_number_to_string`. The JVM gets a zmij port in
  `NtsRuntime.numberToString`. Wasm keeps V8's.
- **Parsing:** Eisel–Lemire (nts C, plus a Java port) replaces `strtod`/`Double.parseDouble` on
  the hot path of `nts_str_to_number`, `parseFloat` and the TypeScript parser's `Number(slice)`.
- **Soundness:**
  - the existing 4,166,499-double cross-check that `nts_grisu.h` was validated with, rerun against
    `js_dtoa` with zero differences;
  - a round-trip property test (format, then parse, gives the same bits);
  - test262 `Number.prototype.toString`, `String(number)` and `Number(string)` records unchanged
    on all four backends.

| row (C backend) | today (measured) | node / Bun (measured) | expected after S1 (estimated) |
|---|---:|---:|---:|
| canada through today's graph serializer | 15.6 ms | 7.39 / 4.12 ms | 8–13 ms |
| `json-serialize` (the existing micro-row) | 12.77 µs | 12.21 / 5.89 µs (nts's TypeScript on the hosts) | 6–9 µs |

**Basis:**

- **The formatter:** zmij at 6.45 ns against 87 ns for the Grisu3/double-conversion class, on an
  M1 Pro (survey, [M]). Assume 8–12 ns on this machine with the layout.
- **The canada row:** canada has 111,080 non-integral doubles. If formatting is 30–80 ns of each
  today, S1 saves 2.2–7.8 ms of the 15.6.
- **What it means for the stages:** this stage alone does not reach node on canada. It is the
  floor S2 builds on.

### S2: typed stringify (`JsonStringify` boundary, generator v1)

- **Builds:** `JSON.stringify(x)` becomes a global for a statically typed `x` (primitives, layouts,
  arrays, tuples, unions, `Record`), with pre-quoted keys, the SIMD escape-copy kernel, `space` and
  `toJSON`.
- **Refused by name:** a replacer function or list (until S6); an erased argument (until S5).
- **This first because** it is the smallest compiler feature with the largest measured win
  (`json-stringify-fused`, 5.8× over the graph, already ahead of node's built-in in hand-written
  form). Typed stringify also needs no index, no new object model and no parse semantics.
- **Soundness:**
  - test262 `built-ins/JSON/stringify` (66 files), the ones expressible over typed values;
  - fixtures for: `undefined` omitted in objects / `null` in arrays, `NaN`/`Infinity`, `-0`,
    lone-surrogate escaping, U+2028 left unescaped, `\v` as `\u000b`, array-index key order,
    `toJSON` on a class and on `Date`, `space` clamped to 10, nested indentation, empty containers
    with a gap, cycles in a recursive type, `BigInt` → `TypeError`, getters on literals,
    `Map`/`Set` → `{}`;
  - byte-identical output against node over the three corpora.

| row (C backend) | bar: simdjson builder (measured) | node / Bun (measured) | expected after S2 (estimated) | vs node / vs Bun |
|---|---:|---:|---:|---|
| twitter subset, typed | 7.8 µs | 93.6 / 31.5 µs | 12–25 µs | 3.7–7.8× / 1.3–2.6× |
| citm, typed | 73.2 µs | 1,061 / 1,245 µs | 80–130 µs | 8–13× / 9.6–15.6× |
| canada, typed | 1,559 µs | 7,390 / 4,118 µs | 1.0–1.5 ms | 4.9–7.4× / 2.7–4.1× |

**Basis:**

- **Same work as the builder:** simdjson's builder writes the same bytes from structs with
  constant keys, which is what the generator emits.
- **Where nts pays more:** two-byte output where a string is two-byte (twitter's text is CJK, so
  the JS result is UTF-16 where simdjson writes UTF-8), the escape scan on strings without the
  `ESCAPE_FREE` fact (it arrives in S5), and the result string's allocation. That is ×1.1–3.2
  over the builder.
- **canada** is number-bound: zmij against the builder's Dragonbox puts nts at or under the bar.
- **The acceptance line:** ≥ 2× Bun on citm and canada, ≥ 1.5× Bun on the twitter subset, and
  the output byte-identical to node's on all three.

### S3: typed parse (`JsonParse` boundary, generator v1; vendored index on ASCII text)

- **Builds:** `JSON.parse(text) as T` and the other forms of §3.1, with checked mismatches
  (`TypeError` with a path), `SyntaxError` precedence, duplicate keys, the exact-size scratch,
  in-place key matching, Eisel–Lemire, and the SIMD string-end scan.
- **The index, where it applies:** text that is an all-ASCII string uses vendored simdjson's
  stage 1 and index-driven skipping from this first landing. canada does, and the A/B measured
  that path at 1,713 µs.
- **Other text:** Latin-1 and UTF-16 strings use a single validating pass until S4, which is what
  the twitter and citm rows below assume.
- **Refused by name:** a boundary whose results reach key-order or undeclared-key observers (until
  S7); a reviver (until S6).
- **Soundness:**
  - test262 `built-ins/JSON/parse` (77 files), the ones over typed targets;
  - JSONTestSuite `y_`/`n_` files under a `unknown`-free schema, plus every `n_` file as a
    `SyntaxError` through a typed boundary;
  - fixtures for every row of §3.6, plus: mismatches of each kind (wrong kind, `null` into a
    non-nullable, a missing required key, a literal outside its union, a tuple of the wrong
    length, `1.5` into `Int32`, `1e2` into `Int32` accepted), a `SyntaxError` after a
    `TypeError` position (the `SyntaxError` wins), and `__proto__` as a declared and as an
    undeclared key;
  - the three-way differential (typed plan ↔ the existing TypeScript parser ↔ node) over corpora
    and generated documents.

| row (C backend) | bar: simdjson On-Demand typed (measured) | node / Bun (measured) | expected after S3 (estimated) | vs node |
|---|---:|---:|---:|---|
| twitter subset, typed | 103 µs | 581 / 489 µs | 200–250 µs | 2.3–2.9× |
| citm, typed | 461 µs | 1,413 / 1,296 µs | 600–750 µs | 1.9–2.4× |
| canada, typed | 1,422 µs | 3,671 / 4,067 µs | 1.7–1.9 ms (ASCII, so the vendored index applies from S3) | 1.9–2.2× |

The canada row is **measured in prototype**: the §1.4 arm A, 1,713 µs.

**Basis:**

- **What builds the objects:** materialization is simdjson On-Demand's typed time minus its
  stage 1 (56 / 348 / 1,224 µs, measured), with nts's allocator in place of `malloc`.
- **canada** adds 55,350 two-element `NtsArray`s, which C++ holds inline as `std::array`. At
  about 8 ns each that is +0.44 ms.
- **Without the index,** skipping twitter's unread members is a validating scalar scan at about
  1–1.5 GB/s, and that is most of its bytes.
- **Acceptance:** ≥ 2× node on all three typed rows.


### S4: nts's own stage-1 front end, field liveness and lookahead

- **Builds:**
  - nts's stage-1 front end for Latin-1 and UTF-16 strings: the same algorithm as simdjson's, with
    a `packus` input stage, AVX2/SSE4.2/NEON/SWAR tiers, run-time dispatch and a padded tail, in
    the same index format;
  - index-driven skipping for every input;
  - field liveness, so unread fields are validated but never built;
  - discriminant lookahead.
- **Soundness:**
  - on every ASCII input in the test corpora, the front end's index equals vendored simdjson's;
  - each kernel tier forced in turn over the same tests;
  - a fixture that reads one field of a wide type and checks, by `nts_counted_allocations`, that
    the others allocated nothing.

| row (C backend) | bar (measured) | node (measured) | expected after S4 (estimated) | vs node | vs the bar |
|---|---:|---:|---:|---|---|
| twitter subset, typed | 103 µs | 581 µs | 125–160 µs | 3.6–4.6× | 1.2–1.6× slower |
| citm, typed | 461 µs | 1,413 µs | 520–600 µs | 2.4–2.7× | 1.1–1.3× slower |
| canada, typed | 1,422 µs | 3,671 µs | 1.7 ms (measured in prototype, §1.4) | 2.1× | 1.2–1.36× slower |

**Basis:**

- **Stage 1 at simdjson's speed:** 47 / 113 / 198 µs measured. Twitter and citm are two-byte JS
  strings (§1.5), so nts's front end packs twice the bytes: ×1.5 assumed, about 70 and 170 µs.
- **Skipping becomes free:** a jump to the matching bracket over the index.
- **The rest:** materialization as in S3.
- **Acceptance:**
  - within 1.4× of simdjson On-Demand on citm and canada, and 1.6× on the twitter subset;
  - ≥ 3× node on twitter, ≥ 2× node on citm and canada.
- **Why nts can come within the bar's reach at all:** the same index and the same number algorithm.
  The C++ reference's only structural advantage is inline `std::array` points.


### S5: untyped parse and stringify (the generic plan)

- **Builds:**
  - the generator over the recursive `Json` type;
  - `NtsJsonObject` + `NtsShape`;
  - immediate scalars, key and short-value interning;
  - JSON-provenance property access with one-entry inline caches;
  - `JSON.parse` and `JSON.stringify` for `any`/`unknown`;
  - the `ESCAPE_FREE`/`ASCII` string facts.
- **Retires:** the TypeScript `parseJsonText` and `JsonValue` stop being the parse path.
- **Soundness:**
  - test262 `built-ins/JSON` without reviver and replacer;
  - the full JSONTestSuite;
  - fixtures: index-key ordering on a parsed object (`{"b":1,"2":2,"1":3}` → `1,2,b`), a
    duplicate-key position, a mutation after parse (dictionary transition), and 10^6 nested
    arrays on every backend;
  - `nts_cycle_candidates` is 0 per parse-and-release.

| row (C backend) | bar (measured) | node / Bun (measured) | expected after S5 (estimated) | vs node / vs Bun |
|---|---:|---:|---:|---|
| twitter, parse any (+ walk) | simdjson DOM 98 µs, yyjson 279 µs | 581 / 489 µs | 220–320 µs | 1.8–2.6× / 1.5–2.2× |
| citm, parse any | 268 / 387 µs | 1,413 / 1,296 µs | 580–760 µs | 1.9–2.4× / 1.7–2.2× |
| canada, parse any | 1,301 / 1,249 µs | 3,671 / 4,067 µs | 1.8–2.3 ms | 1.6–2.0× / 1.8–2.3× |
| twitter, stringify any | yyjson 98 µs | 973 / 197 µs | 110–180 µs | 5.4–8.8× / 1.1–1.8× |
| citm, stringify any | 146 µs | 1,061 / 1,245 µs | 150–250 µs | 4.2–7× / 5–8.3× |
| canada, stringify any | 1,410 µs | 7,390 / 4,118 µs | 1.1–1.6 ms | 4.6–6.7× / 2.6–3.7× |

**Basis:**

- **The untyped graph is allocation-bound:**
  - twitter has 1,264 objects, 1,050 arrays, 4,754 strings and 13,345 keys;
  - citm has 10,937 objects, 10,451 arrays and 25,869 keys;
  - canada has 56,045 arrays and 111,126 numbers.
  - Counted with Python over the corpora (`build/`).
- **The unit costs assumed:**
  - about 8–15 ns per container: allocation plus copying from scratch;
  - about 3 ns per key, by speculating on the previous sibling's shape;
  - 8–10 ns per non-integral number;
  - immediate scalars free.
- **Stringify** is yyjson's graph walk plus nts's pointer chasing, and two-byte output on twitter.
- **Acceptance:** ≥ 1.5× Bun and ≥ 1.6× node on every untyped parse row; ≥ 1.1× Bun on every
  untyped stringify row.
- **The headline is the ceiling, not a target:** simdjson's DOM is 3–4× under these, because it
  builds no objects at all. A JavaScript `JSON.parse` must build them.

### S6: the callback forms through L1

- **Builds:**
  - the reviver (with `context.source`), the replacer function and list, and `rawJSON`/
    `isRawJSON`, as L1's existing TypeScript over the new representation;
  - typed objects reached through the per-layout JSON descriptor.
- **Acceptance:** all 159 test262 `built-ins/JSON` files on C, LLVM, JVM and Wasm, except any
  that need a property-descriptor or Proxy semantic nts excludes. Those are listed by name in the
  conformance record, never silently.

### S7: key order and undeclared keys on typed results

- **Builds:** the `json_order` and `json_extra` hidden slots, lifting S3's refusal.
- **Soundness:**
  - `Object.keys`/`for…in`/`JSON.stringify` of a typed result whose source order differs from
    the declaration;
  - round-tripping undeclared keys through `JSON.stringify`;
  - the zero-cost claim checked by `nts layouts`: no hidden slot where nothing observes.

### S8: per-target acceleration, and host-or-ours on JS hosts (deferred, Appendix A)

- **JVM:** HotSpot `String` intrinsics and `byte[]` SWAR in the Java kernels.
- **Wasm:**
  - a linear-memory SIMD128 stage 1, kept only if it beats the GC-array scalar kernel on its row;
  - on JS hosts, each form takes the host's `JSON` or ours by its benchmark row and conformance
    record (decision 3).
- **Expectation:**
  - untyped `JSON.parse` / `JSON.stringify` (`any` in, `any` out) on a JS host should be the
    host's, because it returns host objects at V8's native speed;
  - every typed form should be ours, because the host's would need a second traversal through
    host calls to build WasmGC structs.


### S9: byte boundaries and sinks

- **Builds:**
  - `Body.json()`, `fs` and `TextDecoder`-fused parses straight from UTF-8: Keiser–Lemire
    validation, and the WHATWG U+FFFD fallback;
  - stringify straight into UTF-8 sinks;
  - JVM `StringBuilder` and C `_into` writers through `appended_results`.
- **Soundness:**
  - invalid UTF-8 parses exactly as `TextDecoder` would decode it, then `JSON.parse`;
  - a BOM is stripped by `Body.json()` and rejected by `JSON.parse`;
  - `response.json()` and `JSON.parse(await response.text())` are equal on every corpus.

### S10: later, each behind its own row

- **Guard fusion:** an `unknown` result checked by a type guard parses as the guard's type.
- **Element kinds** for erased arrays of only numbers (`double[]` storage).
- **`Record<string,V>` on shapes** (§10.8).
- **Literal-union fields stored as their interned literal**, so `kind: "a" | "b"` allocates
  nothing.

---

## 9. Risks

| risk | what would go wrong | mitigation |
|---|---|---|
| **The typed path diverges from node silently** | key order, undeclared keys, duplicate keys, error precedence or number rounding differ from `JSON.parse` on some input | observability analysis (§3.5), refusal until implemented, and a three-way differential (typed plan ↔ generic plan ↔ node) over the corpora, JSONTestSuite, 2,000 generated documents and every truncation of 400 of them (`json-plain-parse.test.ts` already does this for the TypeScript parser) |
| **SIMD kernel bugs at block edges** | backslash runs, quote carries and multi-byte sequences spanning 64-byte blocks; reads past the end | the tail copied into padded scratch; every kernel tier testable on one machine through a forcing variable (like `SIMDJSON_FORCE_IMPLEMENTATION`); stage-1 output compared with vendored simdjson's index on every UTF-8 test input |
| **Code size and compile time** | a parser and a serializer per layout per program | one function per (layout, mode) rather than per site; shared kernels; the gate's per-module compile-time tripwire; only layouts that reach a JSON boundary get one |
| **RC traffic in builders** | a retain/release pair per stored child turns trees into cycle candidates (measured once: 4,002 → 14,009 candidates per parse) | builders move fresh children; a fixture counting `nts_cycle_candidates` per parse |
| **Allocation is the floor** | measured even in C++: On-Demand into `std::vector`/`std::string` is 461 µs on citm against 268 µs for the DOM, which allocates nothing per value | exact-size containers from scratch; key and short-value interning; field liveness; NoGc bump allocation where the program uses it |
| **Hash flooding through keys** | JSC measured 2,471 ms against 3 ms for colliding keys under an unkeyed hash | per-process seeded hash for key interning and shapes |
| **Baseline CPUs** | nts builds for SSE2 x86-64; AVX2 kernels must not run on a CPU without them | target attributes plus run-time dispatch, with a scalar SWAR tier always present |
| **LLVM without LTO** | `nts build` does not pass `-flto`, so kernels are out-of-line calls on the LLVM backend (they inline in C) | §10.7 |
| **The JVM does not reach SIMD** | Java 8 class files, Android, no Vector API | accept it: the JVM's wins come from typed materialization and HotSpot's own intrinsics; revisit when the Vector API leaves incubation |
| **Wasm has no SIMD on GC arrays** | the untyped Wasm parse may not beat V8's native `JSON.parse` | under decision 3 (host builtins on JS hosts, chosen by row), take the host's for the forms where it wins and ours where ours wins (§8, S8) |
| **Corpora licensing** | redistributing data without a stated licence | untracked pinned fetch (§10.4) |
| **Scratch memory** | stage 1 needs 4 bytes per structural, up to 4× the input for `[1,1,1,…]` | a capped per-thread scratch with streaming chunks past the cap |

---

## 10. Open questions that need your decision

Each has my recommendation. Per your standing rule, if you do not answer, I would take it.

1. **What a mismatch at `JSON.parse(text) as T` does.**
   - **Recommended:** a checked conversion. `TypeError` with a JSON path at the boundary, a
     `SyntaxError` always first.
   - **Alternatives:** a compile error unless the program validates, which refuses the most common
     JSON line in TypeScript; or lenient/trusted, which is unsound with native layouts.
2. **Key order and undeclared keys on typed results.**
   - **Recommended:** keep exactly what the program can observe, and drop the rest. This is free
     when unobserved, and refused until stage S7 implements it.
   - **Alternatives:** always keep them (a cost on every typed object); always drop them (a silent
     divergence from node).
3. **A class as `T`.**
   - **Recommended:** refuse, and point to an interface. JSON never produces an instance, and
     `instanceof` would disagree with node.
4. **Vendoring (decided by you for C/LLVM: vendored simdjson).** Two choices remain.
   - **How the C++ runtime links.**
     - **Recommended:** static (`-static-libstdc++ -Wl,--gc-sections`): +0.6 MB per program that
       uses JSON, and no run-time dependency.
     - **Alternative:** dynamic, a run-time dependency on `libstdc++.so.6` on every machine the
       program runs on.
   - **Whether nts may carry its own stage-1 front end for Latin-1/UTF-16 strings** beside
     simdjson's.
     - **Recommended:** yes. Without it, two of the three standard corpora, as JS strings, would
       pay a UTF-8 transcode costing up to 4× the parse (measured, §1.5), and lone surrogates
       could not be parsed at all.
   - **The rest:**
     - `zmij` (MIT, C) under `runtime/c/zmij/`, unmodified, as `quickjs/` is;
     - the corpora and JSONTestSuite (MIT) as untracked pinned fetches.
5. **CPU baseline.**
   - **Recommended:** keep x86-64 baseline code generation, with run-time dispatch inside the JSON
     kernels.
   - **Alternative:** raise the default to x86-64-v3, which helps all code but drops pre-2013 CPUs.
6. **The depth limit.**
   - **Recommended:** none beyond memory, the same on every backend. Node accepts 10^6 nested
     arrays (integration plan §9).
7. **LTO.**
   - **Recommended:** make `-flto=thin` the default for release builds. It makes LLVM-backend
     programs inline the same kernels the C backend inlines, and it is how the bench already
     builds.
8. **`Record<string,V>` on shapes.**
   - **Recommended:** decide after stage S5 measures `NtsJsonObject`. If shapes win there, move
     `Record` to them too. It owes the same index-keys-first order anyway.
9. **Wasm on JS hosts** is deferred with the rest of Appendix A. When it returns, decision 3
   decides it per form by its rows.

---

## 11. Sources

- G. Langdale, D. Lemire, "Parsing Gigabytes of JSON per Second", *The VLDB Journal* 28(6),
  2019. DOI 10.1007/s00778-019-00578-5, arXiv 1902.08318: §3.1 stage 1, §3.2 stage 2 and tape,
  Table 10.
- J. Keiser, D. Lemire, "Validating UTF-8 In Less Than One Instruction Per Byte", *SPE* 51(5),
  2021. DOI 10.1002/spe.2920, arXiv 2010.03090.
- J. Keiser, D. Lemire, "On-Demand JSON: A Better Way to Parse Documents?", *SPE* 54(6), 2024.
  DOI 10.1002/spe.3313, arXiv 2312.17149. Also simdjson `doc/basics.md`, `doc/ondemand_design.md`.
- D. Lemire, "Number Parsing at a Gigabyte per Second", *SPE* 51(8), 2021. DOI 10.1002/spe.2984,
  arXiv 2101.11408, Table 9. fast_float: <https://github.com/fastfloat/fast_float>.
- simdjson README, `doc/implementation-selection.md`, `doc/builder.md`, v5.0.0 release notes
  (<https://lemire.me/blog/2026/09/28/simdjson-5-0-is-out/>). Source read: v5.0.2 amalgamation.
- simdjson-java: <https://github.com/simdjson/simdjson-java>. Source read: 0.4.0 sources jar
  (`VectorUtils.java`, `ResolvedClass.java`, `StringParser.java`).
- yyjson: <https://github.com/ibireme/yyjson> (`doc/DataStructure.md`, `src/yyjson.c`), 0.13.0.
- V8: <https://v8.dev/blog/json-stringify> (2025), <https://v8.dev/blog/v8-release-76>,
  <https://v8.dev/blog/cost-of-javascript-2019>.
- JSC/Bun: `JSONObject.cpp` (`FastStringifier`), `LiteralParser.h`, `JSONCache.h`;
  oven-sh/bun#32079, oven-sh/WebKit#250. Summarized with URLs in
  `~/.cache/nts-scratch/strings-audit/state-of-the-art.md` §4 and `notes-B-jsc-bun.md`.
- zmij: <https://github.com/vitaut/zmij> (MIT, `zmij.c`/`zmij-c.h`, v1.2),
  <https://vitaut.net/posts/2025/faster-dtoa/>. Dragonbox: <https://github.com/jk-jeon/dragonbox>.
  Ryū: Adams, PLDI 2018. Schubfach in the JDK: JDK-4511638.
- jsoniter: `CodegenImplObjectHash.java` (FNV-1a field hashing). DSL-JSON:
  <https://github.com/ngs-doo/dsl-json> (BSD-3). java-json-benchmark raw results 2026-02-28.
- serde: <https://serde.rs/deserialize-struct.html>, <https://serde.rs/container-attrs.html>.
- WebAssembly SIMD: `proposals/simd/SIMD.md` (`i8x16.swizzle`, `i8x16.bitmask`), relaxed-simd
  `Overview.md`, `WebAssembly/website/features.json`.
- JDK Vector API: JEP 508, JEP 529, JEP 537; JEP 489 (`selectFrom` wrapping); panama-dev
  2024-06 thread on `vpshufb`.
- Corpora origins: <https://github.com/miloyip/nativejson-benchmark> README. JSONTestSuite:
  <https://github.com/nst/JSONTestSuite> (MIT).
- In the repository: `docs/web-platform-integration-plan.md` §9, `docs/any-unknown.md`
  ("Boundary materialization", "Trusted boundary semantics"), `docs/scalar-numbers.md` §4.D,
  `runtime/web-platform/docs/JSON-HANDOFF.md`, `runtime/web-platform/docs/PERFORMANCE.md`,
  `docs/agents/lessons/{memory,measurement,backends}.md`.


---

## Appendix A. Deferred by the narrowing: JVM, Wasm and simdjson-java

This was measured before the scope narrowed, and is kept so it need not be measured again. It is
not part of the plan above.

| measured, µs | twitter | citm | canada |
|---|---:|---:|---:|
| nts JVM today, TypeScript parser (JDK 21) | 2,032 | 3,166 | 22,228 |
| nts JVM today, TypeScript graph serializer | 1,408 | 2,180 | 10,402 |
| simdjson-java 0.4.0 parse / + walk (JDK 27, AVX2) | 464 / 846 | 1,156 / 1,529 | 3,912 / 4,758 |
| simdjson-java schema mode | 468 (subset, `long` ids) | 1,257 (performances only) | fails (integers into `double`) |
| C++→Wasm on node: simdjson DOM (`fallback` kernel) | 494 | 894 | 2,971 |
| C++→Wasm on node: yyjson read / write | 169 / 105 | 454 / 174 | 1,651 / 2,065 |

**The typed TypeScript parser on the JVM:** 308 µs on the `json-parse` document, against node's
native 398 µs, and 20,969 µs on canada.

**Not measured, and why:**

- **nts's own Wasm output:** both programs emit and agree with node, but my timing driver resolved
  the module path wrongly, and the runs were dropped with the narrowing.
- **node and Bun running the typed TypeScript parser:** the same path error.
- **DSL-JSON 2.0.2:** smoke-tested only on E-cores, which is not a timing claim.

**Findings to carry forward when this returns:**

- **simdjson-java is not a dependency nts can take:**
  - Java 24 class files against nts's Java 8 runtime and Android;
  - `--add-modules jdk.incubator.vector` plus a stderr warning;
  - 256/512-bit vectors only;
  - its schema mode rejects integer literals bound to `double` and has no `Map`.
- **Wasm on a JS host:** yyjson compiled to Wasm parses twitter in 169 µs, ahead of V8's own
  `JSON.parse` (581 µs), because it builds no JS objects. So "ours" can beat the host for typed
  forms even without SIMD.
- **The JVM literal limit:** the JVM declines a string literal past 65,535 bytes (`NTS4001`), so
  the bench's data-file support (§7.2) must split literals.
