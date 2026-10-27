# Async

How promises, `async` functions, generators, timers and the event loop behave
in a program nts compiles, and which loop runs the program on each target. For
anyone writing asynchronous TypeScript for nts, or bringing up a new host.
Rejections that end the program are also in [errors.md](errors.md); the
targets themselves are in [targets/](../targets/README.md).

## Three layers

| Layer | Who owns it | How many |
|---|---|---|
| `async`/`await` and generators | the compiler | one lowering, shared by every backend |
| promise semantics, microtasks and the checkpoint | the runtime | three implementations, one contract: the C runtime (for C and LLVM), the JVM's (`nts.rt.NtsPromise`), and one generated into each Wasm module |
| the loop, timers and I/O completions | the host | one per environment (table below) |

Promise ordering is specified and observable, so it is never handed to a
platform primitive with an ordering of its own. The one exception is a
Chromium renderer, where nts uses Blink's microtask queue rather than run a
second one beside it. The three runtime implementations keep one contract by
cross-reference, checked by ordering fixtures compared with node; whether that
should become one shared contract test on every backend is register
[C-4](../open-questions.md#4-concurrency-and-async).

## Promises

- A promise settles once; a second resolution is ignored.
- Reactions run in the order they were added, each as a microtask. Subscribing
  to a promise that has already settled queues a microtask; it never runs the
  reaction inline.
- Resolving with a value follows the specification's three cases: a promise is
  adopted, which takes two microtasks; a thenable, an instance of a class that
  declares `then`, is followed by a job that calls its `then`; anything else
  fulfils.
- `.then`, `.catch` and `.finally` work as methods on any promise, with one
  function type per handler; a `finally` callback that can return a promise is
  refused. `Promise.resolve`, `reject`, `all`, `race` and `withResolvers` are
  provided, and `all` settles one microtask after its last element, as node's
  does. `Promise.allSettled`, `any` and `try` are not provided (NTS1100).
- `new Promise(executor)` compiles where the executor is an arrow written at
  the call: it runs synchronously, and `resolve(v)` settles the promise. A
  `resolve` captured by a closure works; one stored or passed as a value is
  refused (``NTS1001 `resolve` ``), as is an executor that is not an arrow
  written at the call.

`Promise.resolve(p)` returns a new promise where JavaScript returns `p` itself
(`tests/outcomes/promise-resolve-of-a-promise`).

## Async functions

An `async` function, method or arrow compiles to a state machine whose locals
live in a frame object, so nothing is held on a suspended native stack:

- The body runs synchronously up to its first `await`.
- `await p` on a promise resumes one turn after `p` settles, as node's does.
  `await v` on any other value takes one turn, and on a thenable one turn more.
- `return p` with a promise adopts it, two turns later.
- A `throw` rejects the function's promise, and a rejection is an edge into a
  `catch` around the `await`; a `finally` that spans an `await` runs on every
  way out.
- `await` outside an `async` function (top-level `await`) is refused; see
  [modules.md](modules.md#top-level-await-and-importmeta).

## Generators

`function*`, `yield` and `yield*` (as a statement), generator methods (including
`*[Symbol.iterator]()`) and a generator read through `Generator<T>` compile,
and so does stepping one by hand with `next()`. A `for...of` over a generator
allocates nothing per element. A loop left early does not close the
generator: its `return()` is not called. Refused, by name:

- the value of a `yield` (`const v = yield x`, a two-way generator, and the
  `next(v)` that sends it) and the value of a `yield*`;
- calling a generator's `return()` or `throw()` by hand;
- a `finally` that spans a `yield`, which needs iterator closing;
- a `for...of` inside a `try` over a generator another function made.

## Async generators and `for await`

An `async function*` walked by `for await...of` compiles. Refused:

- `for await` over an `AsyncIterable` object, as ``NTS1001 a `for...of` over `AsyncIterable` ``;
- `for await` over a synchronous sequence, which awaits every element;
- calling `next()` on an async generator by hand, whose result is a promise.

A `break` out of a `for await` does not close the generator
(`tests/outcomes/an-early-async-generator-exit-leaves-the-frame-open`). The
whole iteration protocol is register
[L16](../open-questions.md#1-language-and-compiler).

## The checkpoint

Compiled code runs inside an entry and an exit. When the outermost exit is
reached, after the module's top-level code and after every task the loop runs,
the runtime runs a **checkpoint**:

```text
checkpoint:
    do {
        run every queued tick
        run microtasks until the queue is empty
    } while (ticks are queued)
```

A tick queued by a microtask runs in a second pass of the same checkpoint,
before any macrotask. Hosts run every task through the runtime (`nts_task_run`),
which adds the entry and exit around it, so a host cannot skip a checkpoint.
On GTK, Apple and Windows a callback from the platform's own loop that returns
to it is a checkpoint too.

The tick queue exists on every runtime, ahead of the microtasks, as node's
`process.nextTick` queue is. Nothing a compiled program writes reaches it yet:
`process.nextTick` is not provided, and neither is `queueMicrotask`, except in
a Chromium program, which takes it from Blink.

## The event loop on each target

On native targets the host provides the loop and timers through one
interface, `NtsHost` in `runtime/c/nts_runtime.h`: posting a task, posting a
delayed or repeating task and cancelling it, posting from another thread, the
owner-thread test, and three optional entries: running one turn of the loop,
counting operations the program still awaits (so a loop that ends when it runs
out of work does not end early), and, for Blink alone, taking over the
microtask queue.

| Target | The loop | Timers |
|---|---|---|
| a native command-line program (C, LLVM) | libuv's default loop (`runtime/c/nts_uv_host.c`) | libuv's |
| GTK | a GLib source on the default main context turns libuv's loop (`nts_glib_host.c`) | libuv's |
| Apple, in a program that uses Objective-C or a framework | the main `CFRunLoop`, so `NSApplication`'s too, turns libuv's loop (`nts_cf_host.c`); other programs use plain libuv | libuv's |
| Windows | libuv's, with a watcher thread on its completion port and a message-only window (`nts_win_host.c`) | libuv's |
| Chromium (opt-in, Linux x86-64) | Blink's; nts uses Blink's microtask queue | Blink's, through `nts:dom` |
| a Node addon | none of nts's: the addon installs no host, so a timer the program posts stops it by name ("before a host was installed"); `runtime/node`'s own modules use node's timers | none ([node addons](../targets/node-addon.md)) |
| the JVM | the program's own thread runs the runtime's queue and timer heap (`NtsEnv`) | the runtime's, on a virtual clock in the default environment |
| Wasm | the JavaScript host's | the host's `setTimeout` and `setInterval` |

`nts check` links a deterministic test host instead, with virtual time and no
I/O, so promise ordering is reproducible.

On the JVM, the default environment (the one a runnable jar uses) advances a
virtual clock: a timer fires when nothing else is runnable, in deadline order,
without waiting out its delay as node would. A promise does not cross a Node addon's boundary
(register [I-4](../open-questions.md#5-interop-and-hosts)), and on Wasm a
promise an export returns becomes a JavaScript promise, whose reactions run on
the host's queue (register [C-5](../open-questions.md#4-concurrency-and-async)).

## Timers

`setTimeout`, `setInterval`, `clearTimeout` and `clearInterval` are provided on
C, LLVM, the JVM and Wasm.

- **The delay**, on native targets and the JVM, is truncated to whole
  milliseconds, with `NaN` or a negative read as 0 and a cap at 2^53, by one
  rule in the runtime (`nts_delay`) rather than in each host. There is no
  floor of 1 ms, so `setTimeout(a, 1); setTimeout(b, 0)` runs `b` first, where
  node runs `a` first (register
  [C-6](../open-questions.md#4-concurrency-and-async)). Wasm hands the delay to
  the JavaScript host, and Chromium applies HTML's rule.
- **Equal deadlines** fire in the order the timers were created.
- **Refused:** a timer that forwards arguments to its callback
  (`setTimeout(f, 10, x)`), a callback that is not a function, a timer id that
  is not a number (such as node's `Timeout` object under `@types/node`), and a
  `clearTimeout` with no timer.

`setImmediate` is a node global, absent from the default library.

## Unhandled rejections

A promise rejected with no handler is a candidate; at the end of the outermost
checkpoint, every candidate still unhandled ends the program as an uncaught
error. On C, LLVM and the JVM the line is `nts: uncaught RangeError` for an
error object (its class, without the message) or the thrown value itself, and
the exit status is 1. On Wasm the reason is thrown to the JavaScript host.

## Threads

Compiled code runs on one thread, the one that owns its runtime. A completion
from any other thread reaches the heap only by posting through the host
(`post_from_any_thread`). Under libuv the owner is the thread that installed
the host, and a callback entering compiled code from another thread stops the
program by name. With no host installed, as in a Node addon or a library, the
owner test answers true and a foreign thread is not detected (register
[C-3](../open-questions.md#4-concurrency-and-async)). There are no workers yet
(register [C-1](../open-questions.md#4-concurrency-and-async)).

## Decisions

- An unhandled promise rejection follows the same per-target split as an
  exception escaping a host callback ([errors.md](errors.md#callbacks-a-host-invokes);
  10-27,
  [Language and hosts](../records/notebooks/decisions-log.md#language-and-hosts-10-27)).
- Workers are isolated heaps with non-atomic reference counts, permanently;
  sending without a copy may come later (10-27, M2,
  [Memory management](../records/notebooks/decisions-log.md#memory-management-10-27)).
- The clock and randomness come from the environment, with a virtual clock and
  seeded randomness under the differential tests (10-22, decision 2,
  [Builtins and runtimes](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22)).
  The JVM's virtual clock in a runnable jar is not that.
