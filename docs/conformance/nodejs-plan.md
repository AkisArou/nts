# Node conformance — what to do next

Companion to [`nodejs.md`](nodejs.md), which records what is true. This file
records what to do about it, and why in that order. Every number here was
measured on the date of the commit that introduced it; re-measure before acting
on any of them.

## The situation in one paragraph

Two axes move independently, and right now one is finished and the other has
never started. **TypeScript-on-node: 1,796 of 1,796 across 22 modules, 0
hollow, nothing failing.** **Compiled artifact: 0 of 22, and one compiler
feature from 1.** Not one module
produces a working addon. The project exists to compile TypeScript to native
code, so the green axis is the *preparation* and the red one is the product. A
plan that spends its next month on the green axis is a plan to build a very
good reimplementation of Node that does not compile.

Everything below is ordered by that.

---

## A. Make one module compile, end to end

**Why first.** `0 of 22` is the only number in this document that measures the
thing the project is for. It has also never been anything else, which means no
one has yet walked a single module the whole way and found out what the walk
costs. Until one has, every estimate about the compiled axis is a guess.

**The beachhead is `punycode`.** Measured on one pinned binary:

| module | lowered | refused | backend-refused | its tests |
| --- | ---: | ---: | ---: | ---: |
| `punycode` | 19 | **1** | **6** | 1 |
| `path` | 257 | 32 | 53 | 17 |
| `async_hooks` | 263 | 53 | 39 | 112 |
| `diagnostics_channel` | 261 | 55 | 43 | 32 |
| `timers` | 288 | 60 | 46 | 54 |
| `buffer` | 374 | 79 | 136 | 50 |

`punycode` has seven refusals in total. It is deprecated in node and worth
almost nothing as a feature, which is exactly why it is the right first target:
nobody needs the outcome, so the exercise is honest about being an exercise.
The question it answers is *what does the last mile actually contain* — and
that answer is currently unknown, because the axis has only ever been measured
in aggregate.

Then `path` (85 total refusals, 17 tests, pure computation, no bindings), then
`diagnostics_channel` / `async_hooks` / `timers`, which sit together around 90
to 106 and are the first with real test weight behind them.

**Measured across all 22 modules since this was written, and it changes what
the ordering means.** 6,039 (module, root) pairs over 1,491 distinct root
sites, on one pinned binary. The frontier is about *import edges* rather than
about which code is hard.

**Twenty-one root sites in `internal/errors.ts` each block 20 of the 22
modules** — not twenty pairs, twenty modules apiece. Seven of the twenty-one
are the same kind, *a conversion to string from this type*, so they may be one
fix rather than seven.

Counting each module's roots and how many lie outside the shared `internal/`
layer:

| module | roots | outside `internal/` |
| --- | ---: | ---: |
| `punycode` | 1 | **0** |
| `path` | 32 | 6 |
| `async_hooks` | 53 | 20 |
| `diagnostics_channel` | 55 | 20 |
| `timers` | 60 | 26 |
| `fs` | 1065 | 1016 |

**`punycode` is the only module whose every root is in shared code.** That is a
better reason to take it first than its size: it is the one module where
fixing the shared layer is *sufficient*. `path` is the interesting second — its
six own roots are all in `glob-matcher.ts`, which serves `matchesGlob`, the one
function `path` does not claim behaviourally anyway.

So the two goals separate cleanly. **For the first artifact to exist**, it is
the annotated-const bug under `punycode` and nothing else. **For the most
modules reachable per fix**, it is `internal/errors.ts`. Both are the compiler
lane's; this lane's job was to say which is which, and to keep saying it with
numbers that were re-measured rather than remembered.

**Order by destination, not by proximity.** The list above is sorted by
cheapness, and cheapness is a tiebreak rather than a reason. `punycode` is
first because it is a *complete traverse* of an untraversed path, not because
it is small. If the traverse turns out to be cheap, the next four are worth
doing immediately; if it turns out to be expensive, that is the single most
valuable thing this project could learn, and it is better learned on seven
refusals than on `fs`'s three thousand.

**What belongs to this lane and what does not.** The refusals are the compiler
lane's to fix. What is ours:

- Keep the source node-faithful. Never rewrite a correct module to dodge a
  refusal; the ledger has a section on why that trade loses.
- Turn each blocker into a minimal reproduction. A hundred-line fixture that
  lowers beats "`process` does not compile" — see the `BrokenBase` handoff,
  where a whole module was a poor reproduction of a four-class inheritance bug.
- Measure with a pinned binary, always. `NTS_BIN=<copy>`; the tree is shared
  and a run that spans a rebuild is a mixed measurement.

**Done looks like:** `tooling/conformance/check.sh punycode` green on the addon
axis. That would be the first non-zero this axis has ever reported.

### The blockers are fixtures, not sentences

`tooling/conformance/blockers/` holds a minimal reproduction of every
compiled-axis blocker this lane has reported, and `blockers-check.mjs`
re-measures them against whatever compiler is current:

    NTS_COMPILER=<a pinned copy> node tooling/conformance/blockers-check.mjs

    guard ok    annotated-const-write     fixed; the first repair broke `instanceof`
    guard ok    f64-parameter             fixed 22:54
    guard ok    f64-return                fixed 22:54
    reproduces  instanceof-no-class       DataView, Map, Set, Date
    reproduces  narrowed-bigint           gates 11 of `path`'s exports
    reproduces  promise-with-resolvers    292 of `fs`'s 2,078
    reproduces  type-parameter-optional   what `Fifo<T>` has
    reproduces  value-export              `punycode`'s `version`

**It reports `FIXED` loudly rather than as a pass**, which is how the `f64[]`
repair was noticed within a minute of the binary landing rather than at the next
time somebody thought to look. A fixture that expects *no* refusal is a
regression guard, and the annotated-const one exists because that repair landed
twice — the first laid the object out as the declared type and broke
`instanceof`, one relation recorded and a narrower one walked.

**Two of the eight are invisible to `nts hir`.** `f64[]` lowers cleanly and
fails at the wrapper, so the usual instrument reports "nothing refused" and says
nothing; the runner takes its command from the expectation. That was worth
encoding rather than remembering — this document quoted those two from
`punycode`'s build for hours without noticing the discrepancy.

**And the reason the directory exists at all**: the largest blocker in `fs` was
reported here for hours as "nullable properties", which is a description of a
grouped diagnostic rather than of anything that refuses. A plain nullable
property compiles. One fixture would have caught it the first day.

### What the last mile actually contains, measured

**Scoreboard, re-measured on each new compiler binary rather than remembered:**

| # | blocker | state |
| --- | --- | --- |
| 1 | an annotated `const` takes its receiver type from the initializer | **fixed**, verified here |
| 2 | the Node-API wrapper never called `module__init` | **fixed**, verified here |
| 3 | `build.sh` named three of the four generated `.c` files | **fixed**, this lane |
| 4 | a compiled `throw` did not cross the boundary | **fixed**, and sufficient |
| 5a | the addon named exports after the function, not the binding | **fixed**, verified here |
| 5b | an export the backend cannot represent was dropped in silence | **fixed**, verified here |
| 5c | no exported object literal of functions — `ucs2` as a namespace | **fixed**, verified here |
| 5d | `number[]` cannot cross the Node-API boundary in either direction | **fixed**, verified here |
| 7 | an addon's process warning goes to stderr, not `process.emitWarning` | **written here**, needs one line from the backend |
| 6 | the Node-API boundary flattens a thrown error's class | **fixed**, verified here |

**Blocker 6 is fixed, and the loop it closed is the argument for this whole
section.** The difference was found this morning, written into this document as
"`instanceof RangeError` being false is a real difference and is recorded as
one, but no pinned assertion touches it", and left. It became an assertion in
the evening, fired on its first run against a real addon, was reported, and is
now repaired and verified by the same file:

    before                                     now
    constructor.name       = Error             = RangeError
    instanceof RangeError  = false             = true
    getPrototypeOf === RangeError.prototype  false  ->  true

    local/error-identity-static.js   FAIL  ->  pass

Node's own test could not have caught it: it asserts the error's *string form*,
which an `Error` wearing the name satisfies. **The gap between "recorded as a
difference" and "asserted" was the whole distance**, and it was a day.

The addon is still bit-identical to node across 80,128 comparisons after the
repair.

**`punycode` now fails on one thing, and it is not a marshalling gap or a
missing export.** `f64[]` crosses in both directions, `ucs2` publishes, and the
addon's surface is `decode, encode, toASCII, toUnicode, ucs2`. **Every assertion
in `test-punycode.js` passes.** What fails is at exit:

    anonymous was called 0 times, expected 1   (test-punycode.js:32:8)

which is `common.expectWarning('DeprecationWarning', ..., 'DEP0040')`, registered
on line 30 and never satisfied. Probed directly:

    process.on("warning", ...) then require(addon)
      stderr:  (node:…) DeprecationWarning: The `punycode` module is deprecated…
      events:  0

**The addon writes the warning to stderr instead of emitting it as a process
event.** The TypeScript lane passes the same test because
`internal/bindings.node.mjs` routes `nts_process_emit_warning_object` to
`process.emitWarning`, and node defers the `'warning'` event to a later tick —
so an expectation registered after the module loads still catches it.

The reasoning for the current behaviour is in this profile's own source, and it
is right for the case it was written about: `internal/process-warning.ts` says a
native program has no process EventEmitter, so the C half writes to the
diagnostic stream. **A Node-API addon is not that case.** It runs inside node,
there is a `process` to emit on.

**And the sink is `runtime/node/internal/process.c`, which is this lane's, not
`runtime/c`.** That was reported to the compiler lane as theirs before the
symbol was followed. It now tries `process.emitWarning(message, name, code)`
through Node-API and falls back to stderr only when there is no host — guarded
on `__has_include(<node_api.h>)`, since `build.sh` already compiles that
directory with `-I$napi`.

**One line remains, and only `NAPI_MODULE_INIT` can write it.** The runtime
needs the `napi_env`, and nothing in the generated program has one:

    nts_napi_set_env(env);
    module__init();

Order matters — `module__init()` is where the top-level `emitWarning` runs.
Until that call exists the env is null and the behaviour is what it was, so the
change is inert in the tree.

**Getting there cost two mistakes worth keeping.** Reading the code back off the
warning object reintroduced blocker 1's *read* variant and cascaded to every
`punycode` export: the allocation-site repair covers a `new` initializer, and
this one is a parameter. That is now `blockers/annotated-const-read`. And moving
the host call up into `emitWarning` emitted a `NtsObj_ProcessWarning *` against
a declaration saying `NtsObj_Error *` — widening at an assignment does not
change what a value *is*, only a parameter's type does. The call stays where the
parameter is typed `Error`, and the code rides beside it.

**The green row is pre-validated as real, not degenerate.** The sweep's harder
question — keep the addon's names and destroy its behaviour — was asked of
`punycode` before it can pass, because the first pass ever reported on this axis
did not survive it:

    run.mjs --module punycode --addon … --mutate-addon
      FAIL  test-punycode.js               poisoned export encode was called
      FAIL  local/error-identity-static.js decode(" ") threw Error that is not a RangeError
      2 file(s): 0 passed, 2 failed

Both files depend on what the module *does*. So when blocker 7 lands the row
will be 2 of 2 with 0 degenerate, and that is known now rather than discovered
afterwards.

**Two caveats, so "punycode green" would mean what it says.** `version` still
does not publish — a string constant node's test never touches, so the test can
pass with the module incomplete. And `local/error-identity-static.js` will still
fail on blocker 6. So `punycode` would pass **node's own tests** and not this
profile's sweep, and both sentences are true.

**The history below is what the last mile looked like from further back.** Namespace registration landed, so
`ucs2` is no longer unnameable; the two functions that would hang off it have no
wrapper because `number[]` cannot cross the boundary:

    no wrapper for ucs2decode: returns f64[]
    no wrapper for ucs2encode: takes f64[]
    no wrapper for ucs2.decode: is a namespace member whose function has no wrapper

Those are node's own signatures — `ucs2.decode` returns code points and
`ucs2.encode` consumes them — so there is nothing to restructure here without
changing what the module is. The addon publishes `decode`, `encode`, `toASCII`
and `toUnicode` and builds the namespace object; only its members are missing.

**The chain of diagnostics is worth keeping, because each layer was invisible
until the one above it moved:**

    punycode.encode is not a function        everything refused
    -> Cannot read properties of undefined   ucs2 unnameable
    -> ucs2.encode has no wrapper            namespace works, members do not

Same test, three sentences, each true when it was printed. This is what a last
mile actually looks like: not one obstacle behind another in a queue somebody
could have listed, but a depth nobody could measure until each layer was gone.

**Blocker 1 is fixed, and 5c with it.** Verified on a pinned binary with a
clean tree: `nts hir runtime/node/punycode/tsconfig.json` reports **20
functions, nothing refused**, the source that refused this morning compiles as
written, and the addon computes `decode`, `encode`, `toASCII` and `toUnicode`
correctly with no workaround anywhere in the tree. The entire remaining
distance to this project's first green row on the compiled axis is:

    no wrapper for ucs2: is exported and is not a function this backend can name

`version` is the other unpublished name and does not matter — node's test never
touches it. `ucs2` it uses six times. **One export shape, one module.** None of
the wider work is in front of it: not the 21 roots in `internal/errors.ts`, not
the void-field struct emitter, not the `NtsTask` microtask struct.

The history below is kept because the shape of the mistake is worth more than
the fix.

**Blocker 1 was half fixed first, and the half that was left was the half that
mattered.**
The first repro sent to the compiler lane was too weak: it *read* `w.message`,
which `Error` declares, so it passed for a reason unrelated to the fix while the
real pattern — *writing* a property `Error` does not declare — stayed refused.
The isolation is two fixtures that attach the same type to the same value and
differ only in how it is attached:

    interface Tagged extends Error { code?: string }

    const w: Tagged = new Error(m); w.code = c;     // NTS1001, `code`
    function make(m: string): Tagged { ... }        // 2 functions, nothing refused
    const w = make(m);              w.code = c;

A declared **return type** widens the receiver and the member set follows; a
`const` **annotation** does not. The capability is present and one path does not
reach it. A class with a declared field compiles for the same reason.

**Blocker 5 was three bugs wearing one symptom**, and the count matters more
than the fix: "the addon exports functions only" was a description of what was
observed, not of what was wrong. Exports were named after the function they were
bound to rather than after the binding, so `export const upper = impl.upper`
published and `export const alias = impl.upper` vanished — the same shape,
working or not depending on whether two names happened to coincide. One function
exported under two names published once. A module-private function was pruned out
from under its own export, because reachability was rooted at the export flag,
which a private function does not carry however many aliases export it. All three
are fixed; verified in this lane on a fixture that publishes `direct`, `upper`,
`alias` and `localAlias`, four names from three functions.

**And an export the backend cannot represent now says so:**

    no wrapper for ucs2: is exported and is not a function this backend can name
    no wrapper for version: is exported and is not a function this backend can name

That diagnostic is worth more than the feature it announces. The silent drop was
the expensive half: a refusal costs an hour, and an export that is simply absent
costs a day of chasing a runtime `is not a function` that names nothing.

**Blocker 4 is fixed and sufficient, and the paragraph that used to be here was
wrong.** It claimed the error class was flattened in a way that decided the
test. Measured properly:

    e.name                  = RangeError
    e.constructor.name      = Error
    String(e)               = "RangeError: Invalid input"
    e instanceof RangeError = false
    /^RangeError: Invalid input$/.test(String(e))  = true

`assert.throws(fn, /regex/)` matches the error's *string form*, which is built
from `name`, so all three of `test-punycode.js`'s throw assertions pass against
the compiled addon today. `instanceof RangeError` being false is a real
difference and is recorded as one, but no pinned assertion touches it.

The mistake is worth keeping because of its shape: `e.constructor.name` was
read and the test's behaviour inferred from it, while the evidence against was
already on screen — the test run had reached line **257**, which is past the
throws at 58-66. **One property was measured and a different property's
behaviour was reported.**

**And the sentence that followed it was the more expensive mistake.** "`instanceof
RangeError` being false is a real difference and is recorded as one, but no
pinned assertion touches it" is true and was the wrong conclusion. *No test
covers it* is a fact about the tests, not about the code — which this document
had already written down, in the line about a comment asserting a property no
test covers being a test asserting nothing. It was filed as a difference and
left.

It is blocker 6 now, found by `punycode/test/error-identity-static.js` on its
first run against a compiled artifact:

    name                              = RangeError
    String(e)                         = "RangeError: Invalid input"
    constructor.name                  = Error
    instanceof Error                  = true
    instanceof RangeError             = false
    getPrototypeOf(e) === Error.prototype = true

The wrapper builds a generic JS `Error` and assigns `.name`. Everything derived
from the string form is right and the class is gone. Node-API can express it —
`napi_create_range_error` and `napi_create_type_error` produce genuine ones — so
this is constructor selection at the boundary, not a limit of the ABI.

**It also raises the bar on `punycode`.** Node's own `test-punycode.js` needs
only the `f64[]` crossing, because it asserts by regex on the string form.
Green *in the sweep* needs both. That is the right bar and the test stays.

**Blocker 5 only became visible once 4 stopped killing the process.** The
pinned test then ran past every throw and died on `punycode.ucs2.encode`.
`punycode`'s public shape is six keys — `version`, `ucs2`, and four functions —
and `NAPI_MODULE_INIT` publishes the four functions. That is also what the
sweep has been calling `built-exports-partial`: `os` reports "0 / 6, 4 name(s)
published" and every one of its tests dies on `Cannot read properties of
undefined (reading 'UV_UDP_REUSEADDR')`, because `os.constants` is a table
rather than a function. **A module whose public API is not purely functions
cannot currently be an addon, and that is most of them** — which makes 5 a
wider gate than 1, since 1 is specific to `punycode`.

**But for `punycode` specifically, 5 is narrower than that.** Counting what the
test actually uses: `decode` ×10, `encode` ×7, `ucs2.encode` ×6, `toUnicode`
×2, `toASCII` ×2, and `version` **×0**. The four functions already work, and
the one plain value in the shape is never touched. So what stands between
`punycode` and a passing compiled addon is a *namespace containing two
functions* — not general support for exporting values. `os` still needs the
general form, since `os.constants` is a table and every one of its tests dies
on it.

**Which leaves the shortest path to the first passing addon at two compiler
items: blocker 1, and namespace exports.** Every other candidate is further:
`querystring` has the only other purely-functional shape worth trying — seven
functions, no values, four tests — and its roots are all in `buffer`
(`ArrayBuffer.isView` with no definition, BigInt where `unknown` is expected,
a conversion to number), not in itself.



### punycode works as native code, and that is now measured rather than hoped

The most useful thing found today is that there is nothing else wrong with it.
The two open blockers are the entire remaining distance, and behind them the
module is finished.

Measured by applying the form-C workaround to `internal/process-warning.ts`
**temporarily**, taking the numbers, and reverting it. It is not committed; the
file is clean. Every figure below is therefore the compiled axis *with the
receiver-type gap routed around locally*, and nothing else changed:

    nts hir runtime/node/punycode/tsconfig.json
      21 function(s), nothing refused
      all of it verifies (21 after pruning unreachable functions)

That is the whole module. **The earlier figure of 19 lowered, 1 refused and 6
backend-refused is obsolete**: the six were downstream of the same root rather
than independent, which is only visible once the root is gone. A cascade counted
as six blockers is six times the work it actually is.

It builds — `target/node/punycode.node`, 275120 bytes — and it computes:

    decode("maana-pta")             -> "mañana"             ok
    encode("mañana")                -> "maana-pta"          ok
    toASCII("mañana.com")           -> "xn--maana-pta.com"  ok
    toUnicode("xn--maana-pta.com")  -> "mañana.com"         ok

Loading the addon also printed the real DEP0040 `DeprecationWarning`, so
`module__init` ran and `emitWarning` crossed into the host through the native
warning seam. The RFC 3492 codec, the surrogate pair handling, the unicode
tables and the warning path all work as compiled native code.

**And where it is reachable it is not merely working, it is identical.**
`tooling/conformance/differential-addon.mjs` asks node the same questions it
asks the addon:

    80128 comparison(s) over 20000 random inputs and 32 fixed:
    0 divergence(s), 0 property failure(s)

Inputs generated across ASCII, Latin-1, Greek and Cyrillic, CJK, emoji and the
astral planes — the ranges where surrogate handling either works or does not —
plus a fixed list carrying what a generator will not reach: the empty string,
bare hyphens, `xn--`, whitespace, 200-character runs, `\u{10FFFF}`. All four
published functions agree with node on every one, and `decode(encode(s))` is the
identity throughout.

That is worth more than the pass count it does not yet have. `test-punycode.js`
is thirty-odd assertions a human chose; this is eighty thousand the compiler has
never seen, and the RFC 3492 codec, the surrogate arithmetic, the overflow
bounds and the unicode tables all come out bit-identical. **The remaining
distance on this module is export plumbing and an error class, not arithmetic.**

Against node's own test, the failure moved:

    before:  punycode.encode is not a function
    now:     Cannot read properties of undefined (reading 'encode')

From "nothing is there" to "`ucs2` is undefined". The test's 10 `decode`, 7
`encode`, 2 `toUnicode` and 2 `toASCII` assertions all pass before it reaches
`ucs2.encode`. **One compiler feature and one type-checker path stand between
this project and its first working compiled addon.**

Ranked by what they buy: 5c buys the first module; blocker 1 buys most of the
rest, since it is the same shape as the 21 root sites in `internal/errors.ts`
that gate 20 of the 22 modules. If only one can be taken first, take blocker 1.

The workaround was not kept, and should not be. A corpus bent around a compiler
gap stops being evidence about node, which is the only thing it is for.

The path was walked end to end by routing around the first refusal temporarily.
The workaround was reverted; what it bought was an inventory, and **three of the
four blockers were invisible until someone walked it.**

1. **The emit refusal.** An annotated `const` takes its receiver type from the
   initializer rather than the annotation, so `const w: Tagged = new Error(m)`
   refuses where `function f(w: Tagged)` and a factory with a declared return
   type both lower. Compiler lane, five-line reproduction, boundary mapped.
2. **The generated Node-API wrapper never calls `module__init()`.**
   `program.c` emits `static NtsString * delimiter = 0;` and a `module__init`
   that assigns it; `addon.c`'s `NAPI_MODULE_INIT` exports the functions and
   calls nothing. Every module-scope constant stays null and the first read
   segfaults — `nts_str_find(needle=0x0)` under `decode`. **Proved by patching
   one line into the generated `addon.c`**, after which the addon returns
   `decode("maana-pta") === "mañana"` and agrees with host node on every input
   tried. This one blocks every module that ever links, not just this one.
3. ~~**One undefined runtime symbol.**~~ **Fixed, and it was this lane's.**
   `nm -D --undefined-only` reported exactly `nts_str_to_lower_case`, and the
   cause was in `tooling/conformance/build.sh`: the compiler emits
   `program.c`, `nts_runtime.c`, `nts_unicode.c` and `addon.c`, and the script
   named three of them. A shared library links happily with an unresolved
   symbol, so it surfaced only when a call reached it. The script now compiles
   every `.c` the compiler emitted, at `-maxdepth 1` because
   `quickjs/libunicode.c` and `quickjs/dtoa.c` are `#include`d by the generated
   sources rather than compiled beside them. Verified: no undefined `nts_`
   symbols, the addon grows from 198,080 to 274,568 bytes, and
   `toUnicode("xn--maana-pta.com")` returns `"mañana.com"`.

   **This is the second time this script has carried a hand-maintained list of
   generated files** — its own comment records the first, a
   `runtime/node/c/node_all.c` that had been deleted. Both were invisible
   because no module reached the link step.
4. **A throw does not cross the Node-API boundary.** `decode("-")` should throw
   a catchable `RangeError`; instead the process prints `nts: uncaught
   RangeError: Invalid input` and dies, with the surrounding `try`/`catch`
   never entered. `test-punycode.js` uses `assert.throws`, so this alone fails
   the file even with 2 and 3 fixed.

**The order that follows from this** is 2, then 4, then 1 — 2 is one line in
the wrapper generator and unblocks anything that links, 4 decides whether
*tests* can pass rather than whether code runs, and 1 is specific to
`punycode`. All three are the compiler lane's. With 3 fixed, the compiled
`punycode` computes every one of its four functions correctly; what it cannot
yet do is survive its own test file, because that file uses `assert.throws`.

**Blocker 4's mechanism, for whoever takes it.** The generated wrapper calls
the compiled function directly —

    NtsString *result = decode(a0);

— with no landing pad and no pending-exception check, and the runtime's throw
path is `_Noreturn void nts_uncaught(NtsValue, const NtsString *)`, which
prints and terminates. So an addon has no route from a compiled `throw` to
`napi_throw`, and that is a design decision rather than a missing line.

**And the cost of learning it was seven refusals rather than `fs`'s three
thousand**, which is the argument for having picked the smallest module made
concrete.

---

## A2. Every module's shape, and what gates it

`blockers.mjs` over all 22, on a pinned binary. The count that matters is
**what `shape.mjs` needs**, not what the addon publishes: `async_hooks` publishes
17 of 31 exports and misses 4 of the 7 names node exposes, because the 17 are
internal helpers `net` and `http` import across module boundaries.

| module | shape needs | published | largest chain root |
| --- | :---: | :---: | --- |
| `punycode` | 6 | **4** | — (only `ucs2`, `version` unpublished) |
| `os` | 23 | 4 | `ERR_OUT_OF_RANGE#constructor` (2) |
| `async_hooks` | 7 | 3 | `determineSpecificType` (2) |
| `path` | 14 | 2 | `determineSpecificType` (11) |
| `http` | 9 | 1 | `methods` (2) |
| `timers` | 7 | 1 | `insert` (3) |
| `querystring` | 1 | 0 | `noEscape` (1) |
| `string_decoder` | 1 | 0 | `decodeIn` (1) |
| `console`, `dgram`, `events`, `net`, `zlib` | 2 | 0 | `ERR_OUT_OF_RANGE#constructor` (net, 5) |
| `util` | 3 | 0 | — |
| `process` | 4 | 0 | `stdinStream` (1) |
| `diagnostics_channel` | 6 | 0 | `channel` (3) |
| `assert`, `readline` | 8 | 0 | `innerOk` (1), `defer` (4) |
| `stream` | 13 | 0 | `writeToWritable` (2) |
| `url` | 13 | 0 | `Url#resolveObject` (2) |
| `buffer` | 14 | 0 | `decodeIn` (3) |

**`punycode` is not merely first, it is first by a distance.** Four of its six
shape names publish and compute; the fifth is `ucs2` and the sixth is `version`,
which no test touches.

**`determineSpecificType` is the largest single lowering root in the profile** —
11 exports in `path` and 2 in `async_hooks`, from one `switch (typeof value)`
that spells the tail of an `ERR_INVALID_ARG_TYPE` message.
`ERR_OUT_OF_RANGE#constructor` is next, gating 5 exports in `net` and 2 in `os`.
Both are in `internal/errors.ts`, which is the answer to "where is the compiled
axis actually stuck": in the code that formats messages for arguments that
failed validation.

**Two single-name modules look short and are not**, and the way that reads
wrong is worth more than the correction. A module whose shape needs one name
suggests one piece of work. Both were checked and neither is.

`querystring` needs `QueryString`, an object of functions — the same shape as
`punycode`'s `ucs2` — so this section first said 5c buys it too. It does not.
Its functions are refused, not unnameable: `decodeURIComponent` is a builtin the
compiler does not provide, two sites narrow an `unknown` to BigInt, `parse`
writes a key `ParsedUrlQuery` does not declare, and `unescapeBuffer` needs
`Buffer#slice`. The namespace was never the blocker.

`string_decoder` needs the `StringDecoder` class exported **and**
`Buffer#toString` lowered, because every method of the class cascades from it.

**Both mistakes have the same shape: a count of names is not a count of work.**
It is the third time that has been true today — a refusal count is a count of
refused functions, a publish count is not a shape, and a shape of one name is
not one blocker.

`fs`'s published count is unknown rather than zero, because `nts layouts` prints
no public API section for it — 5098 lines, exit 0, and no `api` anywhere in the
output, where every other module has one. Reported to the compiler lane. The
refusal census comes from `emit-c` and is unaffected, so the rest of `fs` is
legible:

**`fs` has 2,077 refused constructs and the answer is not in `fs`.**

|  count | kind | where |
| ---: | --- | --- |
| 204 | a property of unrepresentable type (`T \| null`) | `web-platform/streams/fifo.ts`, `writable.ts` |
| 164 | a property of unrepresentable type | `web-platform/streams/writable.ts` |
| 101 | a property of unrepresentable type (`T \| undefined`) | `web-platform/provider`, `node/readline` |
| 82 | a member of a class this compiler has no type for | `web-platform/streams/readable.ts` |
| 77 | assigning to this property | `node/url/searchparams.ts`, `streams/fifo.ts` |

**This section said the largest kind was "a nullable or optional property —
`T | null` and `T | undefined` together are 305 sites", called it how anyone
writes a linked list, and ranked it above `punycode`'s remaining work. That was
wrong, and the fixture is what showed it.** A plain nullable property compiles:

    class Holder { slot: number | undefined = undefined; }        nothing refused
    class Holder { slot: Plain | null = null; }                   nothing refused
    class Holder { readonly slots: (number | undefined)[] = []; } nothing refused

The `| null` is in those diagnostics because it is in the type, not because it
is the cause:

    cap: PromiseWithResolvers<void>          -> unrepresentable (`PromiseWithResolvers`)
    cap: PromiseWithResolvers<void> | null   -> unrepresentable (a union of `PromiseWithResolvers` | null)

Same refusal wearing a union. `blockers.mjs` normalised every backticked token
to `X`, which collapsed those two into one kind with one name and two causes,
and this document then described the group by the wrong one. The grouping keeps
the type now; the member name varies and is never the reason.

**Corrected, `fs`'s 2,078 refusals are:**

|  count | kind |
| ---: | --- |
| 191 | a property of unrepresentable type (`PromiseWithResolvers` \| null) |
| 101 | a property of unrepresentable type (`PromiseWithResolvers`) |
| 82 | a member of a class this compiler has no type for |
| 77 | assigning to this property |
| 66 | `null`/`undefined` where what it stands in for is not a reference |
| 63 | a union of `closeSentinel` \| the type parameter `W` \| undefined |
| 59 | a union of `AsyncIterableIterator` \| undefined |

**`PromiseWithResolvers` alone is 292 of them** — one concrete type, an object
with two function-valued members, 101 of them bare in `writable.ts`. That is the
answer to what the compiler should do first for `fs`, and it is not a language
feature.

**One genuinely new blocker came out of the exercise**, and it is the one
`Fifo<T>` actually has — eight lines, and it refuses at `Slot<Marker>` as well
as `Slot<number>`, so it is the type parameter rather than the instantiation:

    class Slot<T> { value: T | undefined = undefined; }
    -> `null` or `undefined` where what it stands in for is not a reference

This is why `fs`, `stream`, `readline` and `http` all sit where they do.

**This is a different tier from the `punycode` work, and the table above hides
that.** `f64[]` and the error class buy one module with one pinned test file.
Nullable properties buy the streams-shaped half of the profile, and `fs` alone
is 359 test files. "0 of 22" made `fs` and `punycode` look equidistant when one
is two features away and the other is a language feature away.

It also means **web-platform's source is on the compiled critical path for
`node:fs`**, which neither lane had stated.

## B. Breadth — the 24 modules that do not exist

Node ships 46 public modules; this profile implements 22. The table in
`nodejs.md` lists the rest with a reason each.

**One finding should change how this is prioritised.** A new module unlocks
very little in the modules already finished. Measured two ways: 15 of the 422
exclusions are files whose own name belongs to a missing module, and about 51
mention one in prose. So the case for any module is **its own tests**, not a
multiplier on work already done. `child_process` was the obvious candidate on
a leverage argument and the leverage is four exclusions.

Ordered by what is reachable rather than by size:

**Tier 1 — no new provider needed.**
`dns` (30 tests) and `tty` (3 tests) are both phase two in `docs/node-js.md`
and blocked on nothing. `net` already does name resolution through its own
binding, so `dns` is largely surfacing a capability that exists. `tty` is tiny
and closes two real gaps: `process.stdin`'s terminal branch currently reads a
TTY through a socket, and `readline`'s terminal handling has no `tty` to lean
on.

**Tier 2 — a process model.**
`child_process` (112) then `cluster` (83). Needs spawning, IPC and handle
passing. Also retires a class of harness exclusions where a routed child dies
on the `type: module` boundary.

**Tier 3 — the crypto wall.**
`crypto` (128) unlocks `tls` (220), which unlocks `https` (67) and most of
`http2` (277). That is roughly 690 tests behind one provider, and it is the
largest single dependency in the profile. It is also the point at which "port
node's JavaScript" stops working, because node's crypto is a binding over
OpenSSL rather than an algorithm in JavaScript. **Decide the provider before
writing any of it**, and record the decision.

**Tier 4 — engine-shaped, probably never.**
`v8`, `vm`, `inspector`, `trace_events`, `perf_hooks`, `repl`, `test`,
`worker_threads`, `sqlite`, `wasi`, `quic`. Each needs something this runtime
does not have and mostly should not grow. `sys` and `constants` are deprecated;
`sys` is three lines and could be added in an afternoon if anything ever asks.

---

## C. Automate the three audits that found most of this session's work

All three are hand-run today, which means they find things only when someone
remembers to look. Each has already paid for itself once.

1. **Files matching no module's pattern.** Six separate finds, about forty
   applicable tests that were in no denominator on either axis — invisible
   rather than failing. `fs` was reporting 328 of 328 while ten of its own
   tests went unrun.
2. **Export-surface diff.** Load each module through the substitution, take
   `Object.keys`, compare with the real `node:` module. Found
   `url.fileURLToPathBuffer` and `util.aborted` missing, both with pinned tests
   nothing was claiming.
3. **`census-inspect.mjs`.** Already checked in. Enumerates value kinds against
   a written-down set rather than sampling a distribution.

**Done**, in `tooling/conformance/audit.mjs`, run by `sweep.mjs` at the end of
any profile-wide run and failing on anything new. It found fourteen unclaimed
applicable tests on its first run, all of which pass, and one missing export
(`IncomingMessage._addHeaderLines`) behind the only one that did not. The
details are in `nodejs.md`; the one worth repeating here is that the export
half's docstring claimed a re-check the code did not perform, which is the
failure it exists to catch, in itself.

---

## D. Named defects, each with an owner

| defect | axis | owner |
| --- | --- | --- |
| `test-util-inspect-long-running.js` intermittently exhausts the stack — our formatter spends more frames per level than node's, so a thousand-deep `depth: Infinity` fits or does not depending on the caller's remaining stack | TS-on-node | **this lane**; the fix is fewer frames per level, a recursion refactor |
| `util.inspect` renders every `Promise` as `{}` | TS-on-node | compiler lane — `nts_promise_state` is landing |
| Boxed `BigInt`/`Symbol`, generator objects, the four iterator kinds, `arguments` all print as `{}` | TS-on-node | compiler lane — each is downstream of a `util.types` predicate that answers `false` because an erased value has no runtime kind tag |
| `inspect` invokes getters, and a throwing accessor takes down the logger | TS-on-node **only** — the compiled axis refuses the property walk entirely | blocked: needs a computed member read on a known layout, which the compiler lane is taking |
| `test-aborted-util.js` — needs `events` substituted with a `listenerCount` that understands the canonical `EventTarget`, plus the promise reader | TS-on-node | split, this lane and the compiler lane |
| `process` is `c-did-not-compile` from a layout merge bug | compiled | compiler lane; an 85-line reproduction has been handed over |

---

## What not to do, and why

- **Do not chase the 32 unretained partial exclusions.** They were audited:
  most say the public half is already exercised by another applicable test, so
  a `local/` retention would duplicate rather than recover. `blocklist` was
  worth retaining because its 350 lines existed nowhere else; check that
  condition before writing another.
- **Do not try to shrink the 155 §13 exclusions.** They are language non-goals,
  not gaps. If one of them ever becomes reachable it will be because the
  compiler grew a capability, and the exclusion names which.
- **Do not add modules to raise the pass count.** The count is already 100% of
  what is claimed; adding a module adds its tests to both sides of the
  fraction. Add a module because something needs it.
- **Do not treat the green axis as done.** It is green against 22 modules and
  420 named exclusions, on one of two axes. `nodejs.md`'s scope table exists so
  that sentence cannot be shortened into "Node works".

---

## The order I would actually take

1. `punycode` end to end on the compiled axis. Small, and it answers the
   question nothing else answers. **In progress**: it is blocked by exactly one
   root refusal, isolated to five lines with the boundary mapped across four
   variants and handed to the compiler lane. Everything else in the module is
   cascade from it.
2. ~~Fold the pattern audit and export diff into `sweep.mjs`.~~ **Done.**
3. `path`, then `diagnostics_channel`, on the compiled axis — the first two
   with the traverse already understood.
4. `tty`, then `dns`. Small, unblocked, and each closes real gaps in modules
   that already exist.
5. Decide the crypto provider. Not implement it — decide it, write the decision
   down, and cost `tls` against it. It is the largest dependency in the profile
   and it is currently undiscussed.
