# A throw that lands in Node-API: the two cleanup designs measured (#912)

An uncaught `throw` inside a published Node-API entry `longjmp`s to the
wrapper's `NtsLanding`. That jump skips the releases of every compiled frame it
crosses, so a host that keeps running after the throw leaks what those frames
owned. #912's fixture (`localAcrossNestedThrow`: it owns an array, lends it,
then calls a helper two frames deep that throws) leaves 9,600 live bytes after
100 throwing calls, on C and on LLVM. The non-throwing control leaves 0.

Two designs were measured on main `f6f2f1be5bc9` with throwaway experiment
builds. None of the experiment code is committed:

- **(a) return through the raising form.** A published entry calls its
  `@raises` copy, and the wrapper tests `nts_raising()`. Every frame between
  the throw and the wrapper then leaves by an ordinary return, so its releases
  run. Two variants:
  - **(a), copies beside plain bodies.** Lowering seeds a raising copy for
    every published function, method and constructor, and the addon roots the
    copies. Plain bodies stay where module evaluation or a runtime callback
    calls them.
  - **(a′), one raising body.** In an open (addon) product, each plain body
    that has a raising copy becomes a thin adapter: call the copy, then
    `nts_uncaught` if it raised. The prototype did this as a preparation
    rewrite.
- **(b) the landing runs registered cleanup.** Each frame that owns a
  reference across a call that can reach the landing pushes a cleanup record
  (its owned slots) on entry and pops it on exit. `nts_uncaught` releases the
  recorded slots before the jump. This design is not prototyped: it would be
  a new unwinder in two backends, which errors.md's design does not have. It
  is sized by a census of the same prepared HIR, plus a per-frame micro cost.

## Results

| | today | (a) copies beside | (a′) one raising body | (b) registered cleanup |
|---|---:|---:|---:|---:|
| fixture, throwing arm, live bytes after 100 calls (C, LLVM) | 9,600, 9,600 | 0, 0 | 0, 0 | not built |
| fixture control, live bytes | 0, 0 | 0, 0 | 0, 0 | — |
| runtime addons' linked `.text`, C (30 corpora) | 20,945,362 | +17.89% | −4.43% | ≈ +0.3% (est.) |
| runtime addons' linked `.text`, LLVM (27 corpora with all three) | 17,498,309 | +15.76% | −4.86% | ≈ +0.3% (est.) |
| prepared-HIR operations (30 corpora) | 1,571,207 | 2,119,991 (+34.9%) | 1,555,624 (−1.0%) | unchanged |
| functions | 47,642 | 56,642 | 52,621 | unchanged |
| raise tests (`nts_raising`) | 7,323 | 19,547 | 31,632 | unchanged |
| frames that register | — | — | — | 3,020 to 3,888 |
| call sites whose slots must be current | — | — | — | 5,298 to 6,665 |
| normal-path instructions per fixture call (C, no node) | 629.48 | 654.48 (+25.0) | 654.48 (+25.0) | ≈ +14 (micro) |
| stage-1 rows `--count`, nts C and nts LLVM | baseline | within band | within band | unchanged by construction |

How to read the table:

- The `.text` figures include the C runtime linked into every addon, so the
  compiled-code share moves more than the percentages show.
- (a′) is smaller than today because the copies that existing `try`s already
  demanded also stop being duplicated.
- (a′) LLVM declined three corpora (ecmascript, node/process, web-platform).
  The causes are existing raising-copy gaps that more copies now reach:
  `no declaration for TimeZoneSource#resolveNamed@raises to take a signature
  from`, and `never`-typed values in Temporal copies. Their C builds link,
  and they are in the C total.
- (b)'s `.text` figure is an estimate: the registering frames times the
  14-instruction micro cost, divided by the measured `.text`.
- (b)'s frame range runs from "direct calls only" to "every indirect call can
  raise".
- (b)'s micro cost is `registration_micro.c` at `-O2`: 24 instructions today
  against 38 registered, or 44 with the default stack protector, because the
  slot array is address-taken. That is +14 to +20 per frame entry, plus one
  store per change of an owned slot. It also forces owned references into
  memory across calls.

**Stage-1 rows.** `nts-bench --count` was run with the seeding on and off,
from one build (CPU 0, no lock). nts C moved by −2 to +4 instructions per
operation and nts LLVM by at most −4, against a 1-basis-point band
(awfy-towers 941,646 → 941,648 on C, 908,821 → 908,821 on LLVM). Standalone
products prepare with `Roots::Entry`, so a raising copy that only a published
entry names is pruned.

**Published entries that can still `longjmp`.** In (a)'s prepared HIR, at
most 205 exported functions and methods that can reach `nts_uncaught` got no
raising copy, because no copy of them can be made. That is an
over-approximation from the `export` flag. Their throws still need the landing
as a fallback, and they are what #900's guard would have to keep covering
under (a).

## Decision-relevant reading

- (a) with copies beside the plain bodies costs about 18% of `.text`. That
  rules it out.
- (a′) fixes the leak with the existing mechanism, shrinks code, leaves
  standalone programs unchanged, and costs one flag test per raising call on
  addon paths. On the fixture that is +25 instructions per call (+4.0%).
- (b) costs less per call where frames own little, but it is a second exit
  mechanism. It needs new frame-record emission in C and LLVM. Its
  correctness depends on every ownership change keeping a memory slot in
  step with the reference-counting pass, which is an invariant no test checks
  today.

## Evidence

Raw output is in `~/.cache/nts-scratch/912/`:

| File | SHA-256 |
|---|---|
| `bin/nts-a3` (seeds + roots + wrapper) | `1188bbd50bff79cb9dc813d0f4c9744deecb5ae4b3123d3e9613bd3964c793e1` |
| `bin/nts-a3.patch` | `6899d903255e1021f738d0fde601cb3f518ec0de53f5d27b429e8cc2c4132882` |
| `bin/nts-a4` (adds the (a′) rewrite, `NTS_912_A=2`) | `02c4727404386a9c91bf27530b7733e1197f7c4fc89789017fa47cf7bc465b5f` |
| `bin/nts-a4.patch` | `1725e38d98511c343ca797ed63b63ed8bd2d235247cb1a142f43075142ecbd1a` |
| `bin/nts-bench-a3` | `65ad1272236047c7f03da952e98c614c5fa361b22ebc290e62198a2accd9aa42` |
| `census.json` (HIR census, off and (a)) | `12407d4b8cbfe1875806bce4cac01ac07cb2db9d22b1f8719c6ffff5e4b428b3` |
| `size-table.tsv` | `92ce31ceb64b14b41cd2c412022e9099122bef9de12a3f74a14cf4805b11e9a6` |
| `runtime-size/summary.json` (off, (a)) | `66b698a210587845242fe9dee9bb7ef335ebc6650165e518e7e2c2a3a490734e` |
| `runtime-size/summary-a2.json` (off, (a′)) | `eee2401260bfb01a7a356f7a4dd743682bc6e75fa663dcaadcb0412cc4c94ee5` |
| `count/off.txt`, `count/a.txt` | `b1194cad…016714`, `40545c7f…028c03` |
| `percall/counts.txt` | `600bfa820551635ca0bf51ff85085914aed5e52ad91407f20fee41e1b9252f17` |
| `landing/a3-a/summary.json`, `landing/a4-a2/summary.json` | `2b8fd343a48705ea5865ff6cb1e4082aabde27bf8b363f467374f0836ba6b02c` |
| `landing/a2-off/summary.json` | `c85df6a8ba754d9c99a4b57f6fc600696c5f55ae2d82744fc5b4f6cd3865bb56` |
| `micro/registration_micro.s`, `.nossp.s` | `ee65f31f…c6da6ca`, `7b34623e…bd3bcbba` |

The scripts that produced these files are in `scripts/`. The fixture runs
poison-built addons with forced collection before each reading, as #900's
did.
