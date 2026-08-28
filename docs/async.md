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

## 6. How this gets tested

The seam exists for portability, but its **first** value is that it makes the
ordering testable without a real loop.

A deterministic test host — an in-process queue with virtual time, no I/O, no
threads — plugs into `NtsHost` like any other. Against it, ordering is
reproducible: no wall clock, no scheduler jitter, no flakes. Every promise
ordering question can then be asked as a unit test rather than inferred from a
passing integration run.

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
4. The trace-comparison harness: run to quiescence, compare the marker
   sequence against node.

Nothing in A is reachable from TypeScript. It is all testable from C.

**B. The language.**

5. Async frame layout and descriptor.
6. Lowering: `async function` to a state machine. Refuse, by name and from the
   start: `for await`, async generators, and `try`/`finally` spanning an
   `await` — the last needs the exception state machine and is the one most
   likely to be quietly wrong.
7. `Promise.resolve`, `reject`, `all`, `race` as the profile needs them.

**C. The libuv host.**

8. The five operations over `uv_idle_t`, `uv_timer_t`, `uv_async_t`.
9. `setTimeout` / `setInterval` / `clearTimeout` as the `timers` capability;
   `setImmediate` on `post_task`.
10. The standalone runner: run until quiescent, then shut down cleanly.

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
