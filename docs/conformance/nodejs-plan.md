# Node conformance — what to do next

Companion to [`nodejs.md`](nodejs.md), which records what is true. This file
records what to do about it, and why in that order. Every number here was
measured on the date of the commit that introduced it; re-measure before acting
on any of them.

## The situation in one paragraph

Two axes move independently, and right now one is finished and the other has
never started. **TypeScript-on-node: 1,772 of 1,772 across 22 modules, 0
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

**The work:** fold 1 and 2 into `sweep.mjs` as a failing check. A test file that
matches no pattern, or an export node has that we do not, should turn a run red
the day it appears rather than waiting for an audit. This is small, entirely in
this lane, and it protects every number in `nodejs.md` from the one failure
mode a green sweep cannot show.

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
   question nothing else answers.
2. Fold the pattern audit and export diff into `sweep.mjs`. Half a day, and it
   stops the class of bug that produced most of this session's finds.
3. `path`, then `diagnostics_channel`, on the compiled axis — the first two
   with the traverse already understood.
4. `tty`, then `dns`. Small, unblocked, and each closes real gaps in modules
   that already exist.
5. Decide the crypto provider. Not implement it — decide it, write the decision
   down, and cost `tls` against it. It is the largest dependency in the profile
   and it is currently undiscussed.
