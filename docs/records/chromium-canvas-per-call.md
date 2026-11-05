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

1. **Defer a task body's checkpoint to the checkpoint that follows
   it.** The rule is literal: deferring is equivalent only when
   nothing else in the task runs script or queues a microtask after
   the entry returns, before that checkpoint — a C++ promise
   resolution in between would otherwise run its reaction between
   this entry's microtasks and the ones they queue (m1, m2, r1 at
   exit; m1, r1, m2 deferred). By construction only RunTaskBody may
   create a deferred scope, running its body as the whole entry with
   nothing after it; each deferred kind then holds by what its caller
   does next. A timer fire is a whole task whose epilogue checkpoints
   (EventLoop::PerformMicrotaskCheckpoint). A microtask job, a native
   job and a promise settle run inside a checkpoint already — a
   settle from a V8 promise reaction — where no scope checkpoints at
   its own exit either. A string or blob callback is invoked by Blink
   under its own V8RunMicrotasksScope (V8ScriptRunner::CallFunction),
   which checkpoints as the callback returns, before the task's C++
   continues. An embedder task body (nts_blink_dom_task_body) is
   whole-task by contract. Every other entry — listener dispatch,
   observer delivery, animation-frame and idle callbacks, the
   lifecycle entry — checkpoints at its own exit, because Blink
   continues from it inside the same task. A nested entry never adds
   a checkpoint point of its own, as the scope depth already ensured.
   Correctness, from the code: V8's PerformCheckpointInternal would
   bail early on an empty queue if Blink had no
   microtasks-completed callback registered, but Blink registers
   exactly one on its per-agent queue
   (EventLoop::RunEndOfCheckpointTasks: rejected-promise
   notification plus IndexedDB's end-of-checkpoint tasks), and
   ClearKeptObjects runs beside it, so "queue empty" alone never
   shows the checkpoint is a no-op — and no public API exposes V8's
   whole-checkpoint predicate. Guarded by the timer vectors'
   checkpoint scenario (mutation delivery ordered before the next
   task) on both backends, and in DCHECK builds by a structural
   record: a deferred entry marks its checkpoint pending until the
   microtasks-completed callback clears it, and any non-nested entry
   starting first fails a DCHECK naming both entries. The record
   caught one real misclassification on its first exercise: observer
   deliveries (RunCallback) deferred twice in one task, where Blink
   runs the next observer's callback next; they checkpoint at exit
   now. The embedder's lifecycle entry (nts_blink_dom_entry: witness,
   app and rows creation) is not a task body and keeps its at-exit
   checkpoint — measured: with it deferred, a mutation queued by the
   witness program was never delivered (compare c/dom loses
   data-observed), because no scheduler epilogue follows a lifecycle
   entry and Blink discards still-pending end-of-checkpoint work
   when a later checkpoint completes without draining it
   (RunEndOfMicrotaskCheckpointTasks). The kernels harness runs each
   per-call iteration as a whole task body through the same
   production path and performs the task-end checkpoint itself,
   inside the timed region, so both arms of a measurement pay what
   every real task body pays.
   The other two side channels have no scenario to write today, each
   for a stated reason: IndexedDB is not bound (Window's indexedDB
   skipped in bindgen/report-libdom.json; Blink's one
   end-of-checkpoint-task producer is the IDBTransaction
   constructor), WeakRef is unrepresentable in the compiler
   (tests/refusals/weakref-property), and an unhandled compiled
   rejection is reported fatally at the host's own checkpoint
   (runtime/c, nts_report_unhandled_rejections), never through
   Blink's rejected-promises queue. Targets the 52-cycle checkpoint
   plus its 18-cycle scope setup on every task-root entry.
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
