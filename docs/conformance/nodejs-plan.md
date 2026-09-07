# Node conformance — what to do next

Companion to [`nodejs.md`](nodejs.md), which records what is true. This file
records what to do about it, and why in that order. Every number here was
measured on the date of the commit that introduced it; re-measure before acting
on any of them.

## The situation in one paragraph

Two axes move independently, and right now one is finished and the other has
never started. **TypeScript-on-node: 1,786 of 1,786 across 22 modules, 0
hollow, nothing failing.** **Compiled artifact: 0 of 22.** Not one module
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

### What the last mile actually contains, measured

**Scoreboard, re-measured on each new compiler binary rather than remembered:**

| # | blocker | state |
| --- | --- | --- |
| 1 | an annotated `const` takes its receiver type from the initializer | open, compiler lane |
| 2 | the Node-API wrapper never called `module__init` | **fixed**, verified here |
| 3 | `build.sh` named three of the four generated `.c` files | **fixed**, this lane |
| 4 | a compiled `throw` did not cross the boundary | **fixed**, and sufficient |
| 5 | the addon exports functions only — no values, no namespaces | open, compiler lane |

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
