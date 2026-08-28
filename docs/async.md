# Async, promises, and the host seam

How `async`/`await`, promises, timers and the event loop are divided between
the compiler, the runtime and the host — and what has to be built, in what
order.

RFC §12 and §26 say what the division *is*. This says how it is expressed in
code, and why the seam is where it is.

---

## 1. Three layers, decided independently

The question "which platforms use our promises" has three separate answers, and
only one of them varies by platform.

| | Who owns it | How many implementations |
| --- | --- | --- |
| `async`/`await` lowering | the **compiler**, always | one, shared by every backend |
| Promise semantics, microtasks, ticks | the **runtime**, per runtime family | two: native and JVM |
| The loop, timers, I/O completion | the **host** | one per platform |

The middle row is the one people expect to be host-delegated and cannot be.
Promise resolution ordering is specified and observable — FIFO reactions, ahead
of any macrotask, a fixed number of ticks per `await`. Handing that to a
platform primitive with different ordering (`CompletableFuture`,
`dispatch_async`, a GLib idle source) changes what programs print. So the JVM
backend gets a *NativeTS* JVM promise (RFC §13), not a host one, and the same
reasoning forbids every other delegation of the second row.

There is exactly one exception, and it is an exception for the same reason:
a Blink renderer already owns a microtask queue, so running ours beside it
interleaves two individually-correct orderings into a wrong one. There we adopt
Blink's queue rather than run our own. RFC §26.6.

---

## 2. The seam

Everything the host provides, in full:

```c
typedef struct NtsTask {
    void (*run)(void *state);
    void *state;          /* usually a retained managed object */
} NtsTask;

typedef struct NtsHost {
    /* Run after the current task *and* after a complete checkpoint (§3).
     * This is what `setImmediate` is built on, so the ordering is part of the
     * contract rather than each host's business. */
    void (*post_task)(void *host, NtsTask task);

    /* Run after at least `delay_ms`. The id is for `clearTimeout`. */
    NtsTimerId (*post_delayed)(void *host, NtsTask task, double delay_ms,
                               bool repeating);
    void (*cancel_delayed)(void *host, NtsTimerId id);

    /* The only operation callable from a thread the runtime does not own.
     * Every foreign completion goes through this before it may touch the heap
     * (RFC §17.4). */
    void (*post_from_any_thread)(void *host, NtsTask task);

    /* For assertions. Cheap enough to leave on in checked builds. */
    bool (*is_owner_thread)(void *host);

    /* Optional, and null for every host but a Blink renderer. Supplying it
     * means the host owns checkpointing: our queues and our drain at
     * `nts_leave` are both disabled, and there is one queue again. */
    void (*enqueue_microtask)(void *host, NtsTask task);

    void *state;
} NtsHost;
```

Five operations and one opt-out. Everything else — fetch, sockets, the
filesystem, the frame clock — is a *capability* layered on top, and its only
route back into the heap is `post_from_any_thread`.

### What is deliberately absent

- **I/O.** Not a scheduling concern. A capability does its own I/O however the
  platform does, then posts the completion.
- **`unref`.** Only libuv and Node have a notion of a task that does not keep
  the process alive; Dispatch, GLib and Chromium's `TaskRunner` do not. It goes
  in when `timers` and `http` need it, as a host extension, not in the base.
- **Loop phases.** `setImmediate` versus `setTimeout(0)` differs by libuv phase
  and is nondeterministic in Node at top level. Specifying it in the base
  contract would be inventing a guarantee that the reference implementation
  does not make.
- **A way to run the loop.** The host's own `main` owns that. A library product
  has no loop at all (RFC §26.1) and the embedder drives.

---

## 3. The checkpoint

```text
nts_enter(runtime)      depth++
   ... run TypeScript ...
nts_leave(runtime)      depth--; if depth == 0, checkpoint
```

```text
checkpoint:
    do {
        while (tick = ticks.shift())  tick.callback(tick.args)
        drain microtasks until empty
    } while (ticks is not empty)
```

Nesting is by depth because a capability may re-enter TypeScript synchronously,
and only the outermost return is a checkpoint.

The two-queue shape is not a Node special case bolted on. A profile that never
enqueues a tick makes the inner `while` a no-op and the algorithm *is* the
ECMAScript checkpoint. Adding `nextTick` later would have changed the ordering
of programs that already work, which is why it is here from the start.

Two details that tests already depend on:

- A tick enqueued by a microtask runs in a second pass of the same checkpoint,
  not in the next macrotask.
- The drain calls the callback **directly**, holding its arguments beside it in
  the queue entry. Storing a closure and calling that would put an extra frame
  between the drain and the callback, and a stack trace shows it.

### Verified, and one trap in verifying it

The algorithm is not reasoned-to; it is what node does. Queue a timer, an
immediate, a tick, and a microtask that enqueues a second tick:

```text
tick -> microtask -> tick-from-microtask -> immediate -> timer
```

Ticks first, then microtasks, then a second pass for the tick the microtask
enqueued — before either macrotask.

But that is the trace from **CommonJS**, and from inside an I/O callback. The
same program as an ES module gives:

```text
microtask -> tick -> tick-from-microtask -> immediate -> timer
```

The first two are swapped, and nothing about the checkpoint changed. ESM
*evaluation is itself a microtask job*, so top-level code runs with the
microtask queue already draining: a top-level `.then` is picked up by the drain
in progress, and the tick queue is not reached until it empties.

Two things follow, and both are requirements rather than observations.

**Module initialization has to be an ESM evaluation job.** This project's
`tsconfig` is `"module": "ESNext"` and every differential harness imports the
`.ts` directly, so node is the ESM oracle. A compiled program that ran its
module initialization as a plain host task and then checkpointed would produce
CommonJS ordering and differ from node in the first two entries of every trace.
So program start **enqueues module evaluation as a microtask and then runs the
checkpoint**, rather than running it directly.

**The trace harness must fix the module system**, or ordering comparisons drift
for a reason that has nothing to do with the compiler.

**Hosts never see any of this.** The runtime hands the host a task that already
carries its own enter/leave, and the host calls `nts_task_run(task)` rather
than `task.run`. A host cannot omit a checkpoint, because there is nothing for
it to omit. This is the one design decision here that is purely defensive, and
it is worth it: a missing checkpoint produces a program whose promises resolve
late and in the wrong order, and no test *of the host* would fail.

---

## 4. Tasks are roots, and must be run or cancelled

A queued task holds a managed object — an async frame, a promise reaction, a
timer callback. While it is queued it is reachable only from the queue, so:

- Every queue in the runtime is part of the root set (RFC §17.1's root
  registry). Under RC, enqueue retains and dequeue releases; under a tracing
  provider the queues are scanned.
- A task handed to the *host* is held by the host, across a boundary the
  collector cannot see. So the contract is: **every posted task is eventually
  either run or cancelled, and both paths return it to the runtime.** A host
  that drops a task on shutdown without telling us leaks the frame and
  everything it holds.

libuv makes this expressible (`uv_close` takes a close callback); a Looper
message can be removed; a `TaskRunner` task can be abandoned on teardown, which
is the case to check when Chromium arrives.

---

## 5. Async frames

Per RFC §12, an `async` function compiles to a state machine plus a managed
frame:

```text
NtsAsyncFrame
├── descriptor        (so the collector traces the reference fields)
├── state             (which suspension point to resume at)
├── live locals       (only those live across a suspension)
├── awaited promise
├── result promise
├── parent async site (RFC §22, async stack traces)
└── exception state
```

`await p` stores the state and the live locals, subscribes the frame to `p`,
and returns. Resolution enqueues "resume this frame" as a microtask; it does
not resume inline, because inline resumption is a different observable order.

The frame being a managed object with a descriptor is the whole reason §12
prefers this over stackful fibers: there are no roots hidden on a suspended
native stack, and the collector needs no special case.

### One optimization that is not available

`await f()` where `f` is a known async function looks like it could skip the
intermediate promise, the way a Rust future does. It cannot: the number of
ticks per `await` is observable through interleaving with any other pending
promise. The same argument that forbids delegating the queue forbids this.

---

## 5a. What a promise holds

The runtime never learns the *type* of a promise's value, for the same reason
it never learns a closure's signature: whoever reads it was compiled knowing,
and `NtsTask.run` is a compiler-emitted trampoline.

It still has to *store* it, so the payload is a closed two-slot union — a
`double`, or a managed reference — with a tag saying which is live, and a third
state for `void`. That is not `any` creeping in: it is the same closed set of
machine representations as the typed-array element table, written down rather
than discovered. A rejection reason is always a reference, so it uses the same
slot.

The reaction list is the part that constrains the design, because the collector
has to walk it. `nts_each_reference` knows two shapes — an array of references,
and an object with reference fields at fixed offsets — and a dynamic list of
`{run, drop, state}` triples is neither. So a reaction is a small managed object
with one reference field, and the list is an ordinary managed array of them.
Both shapes already trace, and no collector special case is needed.

That costs two allocations beyond the promise for the common single-`await`
case, where an inline first reaction would cost none. The inline version waits
for a benchmark that says it matters: ordering first, then measure.

Two behaviours worth stating because they look like details and are not:

- Subscribing to an **already settled** promise enqueues a microtask; it does
  not run the reaction inline. Running inline changes the tick count, which is
  observable through interleaving.
- Settling twice is a no-op. A promise settles once, and the second resolution
  is silently ignored rather than an error, because that is what the
  specification says and programs rely on it.

Fulfilling and rejecting assert the owner thread. That assertion is the one
that catches a capability adapter resolving straight from its completion thread
(RFC §17.4), which is a data race that usually appears to work.

---

## 5b. What the transform found

Three defects, and all three were the same shape: an operation added to the IR
falling into a `_` arm that was right for its neighbours.

**Escape analysis put the frame on the C stack.** The one object in the program
whose entire purpose is to outlive its caller. `Suspend` hands the frame to the
runtime, which stores it in a promise's reaction list and calls back after the
function has returned -- the definition of escaping -- and it reached a `_ =>
{}`. Nothing failed loudly: the promise stayed pending, because the resumption
was writing through a dangling pointer.

**Dead-code elimination deleted the suspension.** Its effect test was an
*allow-list*, so "pure" was the default for anything new, and a pure operation
with no users is removed. The function set its state, never subscribed, and left
its promise pending forever. It is an exhaustive match now: a list of what has
effects has to be added to; a list of what does not has to be *decided* about.

**`await` of a `Promise<void>` aborted.** Both payload readers assert, and a
promise that settled with nothing has neither slot filled. Three cases, not two.

The first two are the interesting pair, because they produce a program that
*runs and never finishes* rather than one that crashes or answers wrongly.

---

### 5c. The combinators, and the tick they hang on

`Promise.all` and `Promise.race` are one machine with two dials: how many
settlements it waits for, and whether it keeps the values. Writing them as one
is not a saving, it is the claim that they *are* one — both subscribe to every
element, in order, before returning, and both settle their result once.

The part worth pinning is a tick. `all` settles one microtask *after* its last
element: the element's reaction runs, and settling the result schedules its own
reaction. A combinator that resolved inline returns the same values in the same
order and the wrong interleaving, and no test that checks the result can see the
difference. Node says

    Promise.all([Promise.resolve(1), Promise.resolve(2)]).then(v => t("all " + v));
    Promise.resolve().then(()=>t("t1")).then(()=>t("t2")).then(()=>t("t3"));
    // t1 -> all 1,2 -> t2 -> t3

and `runtime/c/tests/combinators.c` asserts that sequence, with five more beside
it: input order preserved when completion order differs, an empty `all`
fulfilled *before it returns*, an empty `race` that never settles, the first
rejection winning, and `race` taking the first element when several are already
settled.

The result array is allocated by the compiler and handed in, rather than the
runtime allocating it from a descriptor. Whether a payload is a double or a
pointer is a fact about the type, and an array already carries its own
descriptor — so passing the array says that fact once instead of twice.

### Rejection, which was aborting

A rejected promise holds a reason and no payload, so both payload readers
assert. `await` of one *aborted the program* — not a wrong answer, a crash, and
one that no test which only awaits successes can reach. It was found by writing
`Promise.all` with a rejecting element, which is to say by accident.

The resumption now tests before it reads, and a rejection goes to a single
block the whole function shares: reject this function's own promise with the
same reason, and return. Shared because it needs nothing from the suspension —
the awaited promise is a frame field, so one block serves every resumption.

With no `try`/`catch` across an `await`, that is the whole of what a rejection
can do, and it is the same thing node does with an uncaught one. `nts check`
compares them: the driver wraps its `await` so a rejection is an answer rather
than the end of the run.

---

### What the general case cost

Two more, on top of the three above.

**A jump carried an argument its block could not name.** A loop's counter is a
block parameter of the header, and a segment reached only from the dispatch is
dominated by nothing that defines it -- so `jump b7(%15, %7)` named `%7`, which
was not in scope there. `carry` reloaded spilled values for *operations* and
nothing did the same for terminators. The verifier caught it, which is the
argument for having one: the emitted C would have compiled and read a stale
local.

**A spilled value was loaded but never stored.** The loads were emitted and the
stores were not, so the far side read whatever the frame was left holding.
Under an allocator that hands back zeroed pages that is a plausible-looking
number rather than an obvious one -- the same shape as the `map` zero-fill,
where "wrong" and "zero" are indistinguishable.

---

## 6. How this gets tested

The seam exists for portability, but its **first** value is that it makes the
ordering testable without a real loop.

A deterministic test host — an in-process queue with virtual time, no I/O, no
threads — plugs into `NtsHost` like any other. Against it, ordering is
reproducible: no wall clock, no scheduler jitter, no flakes. Every promise
ordering question can then be asked as a unit test rather than inferred from a
passing integration run.

The clock must **advance**. When nothing is runnable and a timer is pending,
the deterministic host jumps virtual time to the earliest deadline and fires it.
A fake clock that only ticks when told would strand every `setTimeout`, and
`setTimeout(fn, 0)` and `setImmediate(fn)` both have to run — after a complete
checkpoint, in either order, since node does not promise their relative order
either.

A case may end in an abort, and only one abort is legitimate: an out-of-range
index is the program keeping the promise its `!` made, and node answers
`undefined` for the same input. Every other message the runtime prints is a
defect. Until that distinction existed a declined case did not fail a run, so
putting the async frame back on the C stack -- a use-after-free -- reported
seventeen declines and then "agreed on every case". `nts check` classifies the
abort now and fails on anything that is not the index one.

The oracle for ordering is node, and the harness is a **trace comparison**: a
program prints markers, is run to loop quiescence, and the sequence must match
node's exactly. Ordering is precisely the class of bug that a differential over
*return values* cannot see, which is what `nts check` does today.

That harness has to exist **before** the async lowering lands, not after.
Record 0017's lesson, and the `forEach` defect that followed it, were both the
same shape: a feature marked done with no case that reached it. Async ordering
is the largest surface in this compiler where a wrong answer looks exactly like
a right one.

---

## 7. Why a vtable

The claim the seam makes, first, because everything else in this section is a
consequence of it: **a host is a configuration, not a fork.** The deterministic
host and the libuv host pass the *same* ordering assertions -- a checkpoint
between tasks, timers in delay order, equal deadlines in creation order, an id
that was never issued disturbing nothing -- and those assertions are about the
runtime rather than about either host. That equivalence is what makes this a
contract instead of two implementations that happen to agree today.

So if a host ever needs a second code path, that is a contract bug and not a
host quirk, and the fix belongs in the runtime. The one time it nearly happened
was shutdown identifying its timers by walking the loop, which is only correct
when the loop is ours -- and an embedder passes its own.


A C struct of function pointers, installed on the runtime at startup.

- It is what makes the deterministic test host possible at all (§6). That is
  the strongest reason, ahead of any portability argument.
- It crosses the C ABI, so it serves embedders, shared libraries, and RFC
  §17.3's eventual host-provided runtime.
- Chromium becomes a null check rather than a fork.
- The cost is one indirect call per *task*, not per element, and under LTO with
  a single statically-linked host it is devirtualized anyway.

The alternative — selecting the host with `#ifdef` at compile time — is faster
in a way that does not matter, cannot express `embedder-provided`, and makes
the runtime untestable against a fake. Rejected on the third point.

---

## 8. Plan

Ordered by dependency. Libuv comes first because the Node work in the parallel
session builds on it.

**A. Contracts and the instrument** — no host, no libuv, nothing observable yet.

1. `NtsTask`, `NtsHost`, `nts_enter`/`nts_leave`, the two queues, the
   checkpoint. Owner-thread assertions.
2. Promise: state, reaction list, resolve, reject, subscribe.
3. The deterministic test host with virtual time.
4. The ordering oracle, in two halves — see below.

Nothing in A is reachable from TypeScript. It is all testable from C.

### The oracle splits, and the second half needs a language surface

Step 4 was written as one thing and is two, which only became clear when the
first half was built.

**A4a, done.** The C suites in `runtime/c/tests/`: every expected sequence
transcribed from node, with the program that produced it in the comment beside
it, run against the deterministic host. `checkpoint.c` covers the two queues
and the fixpoint; `promises.c` covers reaction order, deferral, settling once,
and that the reaction chain gives its memory back.

Each was sabotage-tested rather than trusted for passing. That found a real
hole: every promise test subscribed to an *already settled* promise, which goes
straight to the microtask queue and never touches the reaction chain — so the
code that puts the chain back into subscription order had no case reaching it,
and reversing it to LIFO passed the whole suite. The case that reaches it is a
*pending* promise with several subscribers, and it is there now.

**A4b, done, and it needed no new surface.** A trace of markers printed from
TypeScript would have needed something to print with, and `console` belongs to
the Node profile rather than to the core. The way through was to observe the
promises instead: `nts check` drives a promise-returning function, links the
deterministic host, runs the loop to quiescence, and compares what settled
against node's `await`.

Wiring it found the same defect a third time. The differential's own `c_type`
ended in `_ => "double"`, so it declared an `async` function as returning a
number — a pointer marshalled as a double, which clang accepts at the
declaration and rejects only where the two meet. It is exhaustive now. That is
three instances in one day of a catch-all being right for its neighbours and
wrong for the newcomer: `Convert` returning `TOP` in the facts analysis,
`_ => "double"` in the napi wrapper, and this one.

**B. The language.**

5. ~~`Promise<T>` as a type, and `async` without `await`.~~ **Done.** The
   promise is allocated on entry and every `return` settles it and hands it
   back, so falling off the end and a bare `return` are the same path. The three
   named refusals — `for await`, async generators, and a `finally` spanning an
   `await` — are live and checked *ahead* of the `await` rule, so they are
   testable now rather than the day suspension lands.
6. ~~Async frame layout and descriptor.~~ **Done.** The frame is a synthetic
   object type, exactly as a closure is, so it inherits the layout, the
   descriptor, precise tracing, escape analysis and reference counting rather
   than needing a second mechanism for each.
7. ~~Lowering `await`: the state machine.~~ **Done, in general.** `hir::suspend`
   cuts each block into segments at its `await`s, spills everything still needed
   on the far side into the frame, and dispatches on the state through a chain
   of comparisons. Several suspension points, `await` in a branch or a loop, and
   values that outlive a suspension all work.
8. ~~Spilling.~~ Done. Which values need a slot is `liveness::analyze` asked at
   each suspension point, on the *original* function -- what leaves the block,
   plus what the rest of the block reads, minus what does not exist yet. That
   avoids building the body twice.
9. ~~`Promise.resolve`, `reject`, `all`, `race`.~~ **Done**, with the ordering
   asserted against node in `runtime/c/tests/combinators.c` and end to end by
   `nts check` — see 5c. Rejection *propagation* came with them: `await` of a
   rejected promise used to abort, because both payload readers assert and a
   rejected promise has neither slot filled.
10. `new Promise(executor)`, whose hard half is that `resolve` is a closure over
    the promise, so settling reaches back through a function the constructor
    supplied. What used to be its *other* half — that mentioning it cost every
    other promise in the file its payload — is gone: the cause was the `Promise`
    constructor's type dragging 8,189 types of `lib.d.ts` through decomposition
    and exhausting a 4,096 budget, so everything decomposed afterwards silently
    stayed a placeholder. The constructor's surface is recognized and left
    alone now, and a file that mentions `Promise` costs six types rather than
    eight thousand.

**C. The libuv host.**

8. ~~The five operations over `uv_idle_t`, `uv_timer_t`, `uv_async_t`.~~
   **Done.** One handle per operation rather than one per task: the idle is
   started only while its queue has something in it, because an idle handle
   that stays started keeps `uv_run` from ever blocking; the async is
   unreferenced, because an always-active referenced handle would keep a
   finished program alive. `runtime/c/tests/uv_host.c` asserts the *runtime's*
   rules on a real loop — a checkpoint between tasks, timers in delay order,
   equal delays in creation order — rather than testing libuv.

   Two things the suite found. Clearing a timer that already fired is legal and
   common, and a slot table without a generation counter would have cancelled
   whichever timer had reused the slot; that needs two timers and a fire in
   between to reach. And shutdown identified its timers by walking the loop for
   `UV_TIMER` handles, which is wrong the moment the loop is not ours — an
   embedder passes its own — so it reads whatever else is there as an
   `NtsUvTimer`. It walks the slot table now. The suite's own watchdog was the
   foreign handle that found it.
9. ~~`setTimeout` / `setInterval` / `clearTimeout` / `clearInterval` as the
   `timers` capability.~~ **Done**, and in the *runtime* rather than in a host:
   a host provides `post_delayed`, and the capability is built on it, so both
   hosts have it and neither implements it. The callback is a closure, which is
   an object with a method table, so the runtime is handed the object and the
   slot its call occupies -- one slot serves every closure, and what makes that
   safe is that the caller spells the signature.

   `setImmediate` is `post_task` with the same callback object and is *not*
   here, because nothing can reach it: it is a Node global, absent from the
   default library, so no program this compiler accepts can call one. It
   belongs with the profile that declares it.

   Timers are not observable from TypeScript yet. A timer's effect reaches a
   program only through a promise its callback settles, and `new Promise` is
   not implemented -- so `examples/timers` checks that the lowering compiles,
   links and runs, and `runtime/c/tests/timers.c` checks what it does, against
   a closure built by hand in the shape the compiler emits.

   Handing a closure to the runtime also found a hole in reachability. A
   closure's method table is filled only where something dispatches through its
   slot, and `setTimeout`'s callback is dispatched through it by the *runtime*
   -- an external callee, which reachability read as "not in this program, so
   nothing to keep". The body was pruned, the layout's entry went with it, and
   the table was emitted as a null pointer. Nothing failed, because every timer
   in `examples/timers` is cancelled before it can fire, so the call through the
   null was never made. That is what a rule with no case that executes it looks
   like from the outside: a passing suite.

   The case is `a_timer_callback_runs_and_its_effect_is_visible`, which
   schedules a timer nothing cancels and then runs the loop. Reverting the fix
   fails it, and emits the null table.

   The interesting rule there is that an interval and a one-shot give their
   references back differently: a one-shot is run once, so running is what
   gives it back; an interval is run again and again from the same task, so it
   is given back once, by `drop`, at cancel. Running an interval through the
   one-shot path frees its callback and then calls through it -- and the trace
   still comes out right, the totals still balance, and AddressSanitizer says
   nothing, because the allocator pools. What says something is that the live
   set shrank while the timer still held the callback, so that is what the
   suite asserts.
10. ~~The standalone runner.~~ **Done.** `nts emit-c --main` writes a `main.c`
    beside the program: install the libuv host, evaluate the module, run until
    nothing is left, shut down. That is what an executable *is* here -- the
    module's top-level code is the program, which is what `node main.js` runs
    -- and it is why `--main` also makes module evaluation the *reachability*
    root rather than the exports. Nothing outside an executable can call them.

    `examples/standalone` still has two timers pending when evaluation
    finishes, and the assertion is that the binary terminates and exits zero.
    That is not weak: a loop that gave up early exits before they run, and one
    with an idle handle it forgot to stop, or a referenced handle nothing ever
    closes, never exits at all. A compiled program has nothing to print with,
    so termination is the observable.

    It needed module evaluation to exist first, which it did not -- see the
    conformance table. Top-level statements were dropped silently, so there was
    nothing for a runner to call.

The first consumer of A, agreed with the parallel session, is `node:timers` —
59 files and almost pure scheduling. It is a smaller and more honest first
client than `stream`, whose 5,500-line state machine would hide contract
problems rather than surface them. `stream` follows: 230 of its 245 test files
need no I/O at all, so phase A is most of it, and it gates `net` and `http`.

**D. Node specifics**, with the parallel session.

11. `process.nextTick` bound to the tick queue from A — the queue is already
    there, this is the binding and the stack-frame attribution.
12. `setImmediate` phase behaviour, if anything needs the distinction.
13. `unref`, when `timers` or `http` reaches it.

### What is decided and what is not

Decided: the two-queue checkpoint is in the base runtime, because retrofitting
it would change the ordering of programs that already pass. `setImmediate` is
portable and ordered after the checkpoint; the libuv *phase* distinction is
not. `unref` is deferred and is a host extension when it lands.

Not decided: whether the JVM runtime shares any of this in source form or only
in shape; and whether a Blink capsule's promise is adopted into our
representation or held as a handle. Neither blocks A through D.
