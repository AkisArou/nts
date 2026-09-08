# JSON: handoff

Written 2026-09-09 by the Web-platform lane, for whoever continues the JSON performance work.

`PERFORMANCE.md` is the objective and carries the full evidence with its counterfactuals; this
file is the shorter thing you read first. Where they disagree, `PERFORMANCE.md` is right and this
is stale.

---

## Where it stands

**Serialization is done as far as this lane can take it.** Parsing is not started, because it does
not compile.

| row | now | against node's *native* `JSON.stringify` |
| --- | ---: | --- |
| `json-stringify-doc` — the shipped graph serializer | **4.13ms** | 5.3x behind |
| `json-stringify-fused` — hand-written, typed, no graph | **0.691ms** | **0.88x — ahead of it** |

Both serialize the identical 534,107-byte document to byte-identical output, checked character by
character. node's native is 0.782–0.793ms and bun's is 0.341–0.358ms, measured in the same window
as the rows they are compared against — they drift ~10% between sessions, so a ratio built across
two windows is not a ratio.

Other JSON rows, from the publish at `e7342345`: `json-scan` 2.04us (1.20x node), `json-serialize`
14.07us (1.16x), `json-build-append` 19.15us (1.30x), `json-build-join` 19.92us (0.98x).

Host-side, the parse direction on a 1.67MB document: simdjson 0.851ms, bun native 2.962, node
native 4.744, our TypeScript 19.445 on node. **`response.json()` went 23.269ms to 9.465ms** when
it stopped building the erased graph and materializing it in a second pass.

---

## The one thing to take from this

**The gap was never the language or the codegen. It was the erased `JsonValue` graph.**

Four shapes of the same serializer, same document, byte-identical output:

    graph via JsonValue     7.20ms   (before the streaming and fusion work below)
    typed, factored         1.26ms
    typed, inlined          0.99ms
    typed, inlined, fused   0.707ms   <- ahead of node's built-in

**10.2x, with no compiler change at any step.** An hour before that measurement a native port
looked necessary; afterwards it plainly was not. The whole of that is what direct typed
materialization would give: at a boundary where the type is statically known, emit a serializer
for *that type* instead of building a generic representation and walking it.

And the reason it beats node is structural rather than clever: a monomorphic serializer for a
known type does not enumerate properties, look for `toJSON`, or dispatch on a runtime kind. A
generic `JSON.stringify` must. **It is not a faster way to do the same work; it is a smaller
problem** — and it is the one thing a dynamic engine cannot do.

---

## Blocked, and on whom

**`Number(string)`** — `parse.ts:374`, `Number(source.slice(start, end))` in `numberValueOf`.
Blocks `Scanner#readNumber` → `readValue` → `parseJsonText`, so the entire parser has no presence
on the compiled axis and there is no parse row in the bench table. It is the *only* remaining
refusal on that chain; the comparator sort that was the other one is gone. With the compiler lane
as item 3.

**`JSON.parse` / `JSON.stringify` as globals** — `NTS1001 a global member with no definition
here`. No compiled program can call either. Everything in this lane is reachable only by importing
`jsonParse` from the module, which no ordinary program does. Until that resolves, none of this
work reaches a user, and "is our JSON faster than node's" cannot be asked in the terms a user
would ask it.

**Typing the code unit `i32`** — landed, and measured to **zero** on these rows. Do not expect it
to move anything here and do not revert it: it is a correctness claim about the IR, and it is the
prerequisite for anything vectorised, since a loop carrying `f64` code units cannot become
`<32 x i8>` however good the cost model is.

---

## The ideas, in the order I would take them

### 1. Direct typed materialization — measured, 5.8x

`json-stringify-fused` at 0.691ms against the graph route at 4.13ms. The design is settled with
the compiler lane: emit a serializer for the known type, calling `text.ts`'s `quoteJSONString`,
`numberText`, `member`, `resolveGap`, `memberPrefix`, `containerSuffix` and `assembleContainer`
for the leaves and the formatting, and never building a `JsonValue`. `text.ts` imports nothing at
all, which makes it the cheapest possible first use of a module-injection capability.

**Two constraints on the emitted code, both measured, both counter-intuitive:**

- **One flat function per boundary, never a call tree.** `appendRow(out, row)` returning the
  accumulator — the natural factoring, and the one anybody would write — is **50x slower**.
  `out = f(out, x)` holds two live references while `f` runs, `nts_str_append`'s `reserved == 1`
  test fails, and every append copies the whole buffer: 62.81ms against 1.25ms on LLVM, which is
  ~534MB of memcpy and matches at 10GB/s.
- **Key order is not declaration order.** `OrdinaryOwnPropertyKeys` puts array-index-like keys
  first in ascending numeric order, so a type with fields `"10"`, `"2"`, `"x"` emits `2, 10, x` —
  while `"01"`, `"-1"`, `"1.5"` and `"4294967295"` are *not* indices and stay with the strings.
  `arrayIndexOf` in `value.ts` is the predicate. All compile-time computable, all silent if wrong,
  and no type checks it.

Three more the emitter owes: a member whose type admits `undefined` is omitted in an object and
becomes `null` in an array (same type, two behaviours by position); `toJSON` on a member's type is
called if it has one; cycles need detection exactly when the type is recursive, which is decidable
from the type.

### 2. Fuse `acc += quoteJSONString(x)` — measured, 1.41x hand-written / 1.16x on the graph route

A peephole, not a feature. `out += quoteJSONString(x)` allocates the quoted string, copies it into
the accumulator and frees it — about twenty thousand times per serialization on the test document.
Fused, a string needing no escape becomes three in-place appends and allocates nothing.

**The pieces are already in `text.ts` and the classification is not duplicated to use them:**

    firstEscapeIndex(value, from) -> number      the first index needing an escape, or -1
    quoteFromIndex(value, from)   -> string      the quoted form, told where the first escape is

`quoteJSONString` calls both for its own fast path, so Table 78 and the 25.5.4.3 surrogate rule
are written exactly once and the escaping path scans *less* than it used to rather than twice. A
generated serializer can call the same two.

### 3. Parse-side one-pass materialization — 2.46x measured on the host

`toPlainValue(parseJsonText(t))` walked the document twice. `parsePlainText` parses straight into
ordinary values and `Body.json()` takes it: 23.269ms to 9.465ms, from 4.8x off node's native
parser to 1.95x. It shares the `Scanner`, so the grammar, the error text and the number conversion
are still spelled once.

The compiled equivalent is unmeasured and blocked on `Number(string)`. Expect it to matter *more*
than on the serialize side, because parsing **builds** the graph rather than walking one.

### 4. Buffer pre-sizing — estimated ~10%, unmeasured

The accumulator grows by doubling; 534KB is about twenty reallocations. A `reserve` primitive
would let a serializer size the output once. Needs a runtime capability; nothing in TypeScript can
ask for it.

### 5. A vectorised escape-class scan — the SIMD entry point

`quoteJSONString` is 18–21% of the serialize profiles and its inner loop tests one character at a
time. Checking sixteen bytes at once is what simdjson actually exploits.

**Start with this rather than a JSON structural scanner.** It is a byte-class membership test over
a short string — perhaps twenty lines, no state machine, no prefix-XOR, no structural index — it
encodes *no specification* so it cannot disagree with one, and it is measurable today, whereas the
parse-side Stage 1 is behind a refusal. It would prove the intrinsic, the CPU dispatch and the
cost model on real work before anyone commits to the larger build.

### 6. An integer fast path in `nts_number_to_string` — `nts_grisu` was 8.56% of a profile

Half the numbers in an ordinary document are small integers that never need a full dtoa.

**Does the arithmetic reach bun?** Stacking these on the current 0.691ms lands around 0.45–0.60ms
against bun's 0.341. Close, still short. Passing bun needs the vectorised work to beat the
estimate, which it plausibly can — replacing a per-character loop with a per-16-byte one is not a
13%-shaped change when most strings need no escape at all. **Every one of these is a general
primitive that helps every string-building program in the tree, and none duplicates a line of
specification.** That is the argument against a native JSON port, which would have bought three
spec-complete implementations to fix an intermediate data structure we were removing anyway.

---

## Traps, each of which cost real time

**A profile ranks; it never prices.** Three separate wrong conclusions came from reading one.
`nts_collect_cycles` and `nts_array_new` at the top of the graph profile did not mean allocation
was the lever — it meant the architecture was. A profile cannot cost what a different architecture
would *not do at all*.

**A counterfactual is about the workload it ran on.** "Reference counting is a net win" was
established from `NoGc` running 2.3x slower on `json-build-append`. On the document row `NoGc` is
1.6x *faster*. Small live set: reclamation is cheap and not reclaiming stops the working set
fitting. 30,000-node persistent graph: the collector rewalks it every iteration. Both measurements
stand; the sentence drawn from the first was too broad.

**Hosts and an AOT target want opposite code shapes, and a single ratio cannot express it.**
`json-stringify-typed` against `-inline`: bun prefers the factored source 1.02ms to 1.47, we
prefer the inlined one 0.99 to 1.26. And streaming the graph serializer improved it 1.26x while
improving node 1.7x, so `nts/node` went 2.24x → 3.00x on a change that made the program a quarter
faster. **Compare absolute numbers against the previous run before reading a ratio as a
direction.**

**`nts emit-c` roots every export, and a root is a wall** — its parameters stay as wide as their
declared types. Use `--main`, and note that an export nothing calls is then dead, so a probe needs
a module-level `export const x = work(seed)` to keep its subject alive. Four probe results here
were taken the wrong way and two reversed.

**`runtime/web-platform/test/tsconfig.json` is laxer than the one that judges.** It sets
`noUnusedLocals: false` so an editor can resolve a half-written test. Run
`tsc -p tooling/conformance/web-platform/tsconfig.json --noEmit` before believing a refactor is
clean; the file now says so in its own header.

**`benches/tsconfig.json` typechecks the bench cases** and is easy to forget. A required parameter
added to `firstEscapeIndex` silently broke a bench case — `from` was `undefined`, the loop never
ran, every string looked escape-free — and only the byte-for-byte output check caught it.

**Do not patch `Object.prototype.then` in a live process to probe stream observability** unless
the replacement calls its resolver. A badly-behaved one takes node's module machinery down with
it; that cost a five-minute shell hang. And in a test, `Promise.all` resolves with an **array**,
which is an ordinary object, so awaiting one performs the very `Get` for `then` being measured —
the harness then reports its own interception as the stream's.

**`cp` is aliased to a prompting version here.** Use `command cp -f`. A blocked prompt once left a
bench `provider` file on `NoGc` after a counterfactual, which would have silently poisoned every
later run of that row.

---

## Instruments

- **Reading emitted C beats timing**, and does not care whether the machine is busy. `grep` for
  `nts_str_char_code_at_int` versus `nts_str_char_code_at` to see which entry a read took; count
  `= 92.0;` against `= 92;` to see whether a classification is integer.
- `benches/cases/json-stringify-doc/native.mjs` builds the identical document as ordinary objects
  and times the engine's built-in — run it on node *and* bun, in the same window as the row.
- `tooling/gate/wait-idle.sh` then `tooling/gate/with-lock.sh`; discard any run printing a
  variance note. The `json-scan` node column has measured 1.70 through 5.16 on identical source
  while ours held 2.04–2.45, so one sample of that ratio is close to a coin flip.
- `NTS_BENCH_RC=1` and the per-case `provider` file are the two counterfactuals that come free.
- Gate at the end, not during: it is a serialised resource three sessions queue for, and the
  70 JSON tests run in thirty seconds.

## Not to be done

- **A native JSON port.** The 8.8x that made it look necessary was the erased graph. In TypeScript,
  with the specification in one place, the typed route is already ahead of node's built-in.
- **More micro-optimisation of the escaper's classification.** Six spellings ruled out by reading
  emitted C, and the compiler-side fix measured to zero on these rows. `PERFORMANCE.md` has all
  six so nobody repeats them.
- **Optimising `plain.ts` by porting these findings.** It is host-only — it only ever runs on V8 or
  JSC, where `+=` builds a rope and passing a string through a parameter is free. Every constraint
  above came from measuring the compiled target and **none of it transfers**. Profile it there
  first if it is ever worth doing.
