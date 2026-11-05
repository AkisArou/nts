# Canvas per-call, decomposed (2026-11-05)

Brief item 2 (the per-call entry cost), canvas slice: what one compiled
canvas per-call entry pays, segment by segment, and which candidate
removes each cost at its cause. Canvas per-call is the one benchmark row
nts loses to V8 (1.08–1.12× V8 on the kept stack,
`chromium-per-call-entry.md`). This note is the profile MainClaude
ordered before any timed A/B; candidates below, timing waits for a
quiet window.

## Instrument

perf sampling cannot attach to the sandboxed renderer as this user
(perf_event_paranoid=2; both PMUs refuse), and no privilege escalation
is available for measurement. So: a throwaway rdtsc counter build of the
adapter (segment marks inside `ProgramScope`, call guards on the canvas
kernel's four adapter calls), built and run for one kernels launch pair
(nts_shell, perf profile, C backend, main `1994116877d9` compiler),
then reverted. TSC base 3.2 GHz. Probe cost is roughly 5 cycles per
segment mark and 10 per call guard, inside the numbers below. Segment
totals accumulate over all 1,750,000 outermost entries of a kernels
launch (all kernels/shapes); the four adapter calls are canvas-only.
The Exit/refptr-release tail segment failed to accumulate (a probe
ordering bug); it is named from the prior perf record instead. Machine
was under a neighbour's gate load; these are cycle shares for naming
costs, not verdicts. Raw lines:
`~/.cache/chromium-measure/out/canvas-entry-20261105/bench3/launch-1-native.log`.

## What one canvas per-call entry pays (compiled, kept stack = main)

Wall anchors (kept sittings, `chromium-per-call-entry.md`): compiled
222.6 ns, V8 200.0 ns, hand-written C++ intrinsic 162.3 ns; loop-shape
fillRect alone 61 ns in every arm. All three arms re-query the element
and context per call by construction (the intrinsic kernel is the
compiled kernel transcribed); only the compiled-only slices below are
actionable.

| cost | cycles | ~ns | cause |
| --- | --- | --- | --- |
| fillRect (Blink recording + adapter) | 199/call | 62 | the work itself; all arms pay Blink's share |
| getContext("2d") adapter call | 339/call | 106 | mostly Blink's GetCanvasRenderingContext, all arms pay it; compiled-only delta is the exception slot, Current() and HandleOf around it |
| getElementById adapter call | 71/call | 22 | Blink id lookup plus NtsText: an AtomicString found by a by-address HashMap lookup and refcounted, where the intrinsic passes a static atom |
| document() | 15/call | 5 | TLS Current() + handle; intrinsic receives Document& free |
| microtask checkpoint (scope dtor) | 52/entry | 16 | MicrotasksScope kRunMicrotasks checkpoints on every outermost exit, queue empty or not |
| ScriptScope (HandleScope + Context::Enter) | 29/entry | 9 | Blink may ask for the current world under any DOM call |
| Entry (context scoped_refptr + TLS) | 18/entry | 6 | two atomic RMWs to keep the context alive on the one thread entries run on |
| MicrotasksScope ctor | 18/entry | 6 | scope setup |
| Exit + refptr release | unmeasured | ~5–8 | symmetric to Enter; prior perf record kept-stack shares |
| host enters (environment/callback/depth) | inside body | ~5 | three TU-crossing enter/leave pairs in runtime/c (prior record) |

Compiled-only excess over the intrinsic is ~60 ns; the entry machinery
(~120 cycles ≈ 38 ns, consistent with the 32–34 ns bare entry) is most
of it, then the atom lookup and document() deltas. Over V8 (+23 ns)
the same slices apply, V8 paying its own binding overhead (~38 ns over
intrinsic) but no entry scopes.

Explicitly not a cost to chase: the kernel's re-query shape itself.
The V8 and intrinsic arms are written the same way; "fixing" the
kernel would change the benchmark, not the architecture.

## Candidates (each removes its cost at the cause)

1. **Checkpoint only when microtasks are pending.** ProgramScope keeps
   the MicrotasksScope for enqueue semantics but constructs it
   kDoNotRunMicrotasks and performs the checkpoint explicitly at exit
   only when the queue is non-empty. Removes most of the 52-cycle
   checkpoint on entries that queued nothing (canvas, and most DOM
   callbacks). Adapter-only.
2. **Entry count, not refcount** (candidate 4 of the entry stack,
   refreshed): Entry's scoped_refptr becomes a plain count on the
   context with release deferred to the outermost exit. Removes the
   two atomic RMWs (~18 cycles/entry here; measured −51 cycles/entry
   in its A/B, at +31 instructions — the cycles/instructions verdict
   is the quiet-window call).
3. **Combined host entry** (compiler lane): one call that enters
   environment, callback and depth together, one that leaves, in place
   of three pairs across translation units. Already requested with
   numbers in `chromium-per-call-entry.md`; renewed here.
4. **Literal atoms without the hash** (compiler + adapter): a compiled
   string literal carries its AtomicString in a per-literal slot filled
   once per document; NtsText reads the slot instead of a
   by-address HashMap lookup plus refcount churn (~15–25 of the 71
   cycles). Needs the compiler's literal representation to grow the
   slot; filed as a request, adapter half ready when the ABI exists.

Standing costs with no lane-local at-cause design: ScriptScope's
HandleScope + Enter (Blink may ask for the current world at any call;
the already-entered shortcut provably never fires for posted-task
callbacks), and Blink's own getContext/fillRect bodies, which every arm
pays.
