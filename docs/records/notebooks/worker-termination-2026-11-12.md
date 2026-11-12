# Worker termination during async module evaluation

## Observation and reduction

Node 26.13.0 (V8 14.6.202.34-node.40) aborted in loaded
`tooling/census/worker-memory.test.ts` runs at base `fef93db92283` 3/75
and #721 `9bc14851c543` 2/74. Eight cancelled subjects are excluded.
The first matched checkpoint was 2/52 on each pin. The abort was pre-existing.

A standalone builtins-only reduction reproduced the same abort in 16/16
processes. The control completed 100 terminations per process in 16/16
processes, with zero aborts. Every experiment used `LimitCORE=0`, excluded
CPUs 4–5, and ran in a named unit. No report has been sent upstream.

The three files below form the reproduction. Save them together, run
`ulimit -c 0`, then `node parent.mjs`. The control changes only the dependency's
body from `await 0;` to `export {};`.

```js
// dependency.mjs
await 0;
```

```js
// worker.mjs
import './dependency.mjs';
import {parentPort} from 'node:worker_threads';
parentPort.postMessage('ready');
while (true) {}
```

```js
// parent.mjs
import {Worker} from 'node:worker_threads';
for (let i = 0; i < 100; i++) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url));
  await new Promise((resolve, reject) => {
    worker.once('message', () => worker.terminate().then(resolve, reject));
    worker.once('error', reject);
    worker.once('exit', resolve);
  });
}
```

Representative stack, identical to the loaded tooling abort:

```text
Fatal error in , line 0
Check failed: !is_null().
1: 0xa9e161 [node]
2: 0x29452b1 V8_Fatal(char const*, ...) [node]
3: 0x12b5ff1 SourceTextModule::AsyncModuleExecutionFulfilled [node]
4: 0xd32a9a Builtin_CallAsyncModuleFulfilled [node]
```

Local disassembly places the failing check on the async module completion
path executing a synchronous importing module. Worker termination interrupts
that execution without a catchable exception; the path checks the empty
exception handle. The reproduction uses the documented Worker lifecycle API
and no nts modules.

## nts ownership

`reserveJob` starts a sampler Worker on `memory-watch.ts`. Its old synchronous
release called `terminate()` without waiting. The Worker module awaited its
sampling loop at top level. Short jobs and loaded startup made that graph's
evaluation overlap termination. The replacement is a message-started service,
with synchronous final parent accounting and a separate acknowledged shutdown.
The source audit rejects top-level await in Worker entry closures.

The Worker closure contains memory-watch, memory-ledger, host-observations,
cache-capabilities, step-scheduling, step-time and the shutdown helper. Other
CLI top-level awaits found in the main test process's larger graph were
oracle-emit, oracle-dependencies, oracle-resolution and dependency-inputs;
those are separate work (#737).

## Other observations

Deliberately loaded sweeps overlapped #721's landing check. Its next refused
run had no native abort, but held a concurrent stale-pin preflight at its
300-second inactivity guard and two capability probes at their 10-second
spawnSync timeout. Future load experiments check landing status between
batches and wait while a landing is checking.

A fixture's externally launched `nts-test-633-killed` unit survived a killed
test. Nine such units were stopped by their exact names. The fixture now
joins the test's slice and has its own runtime bound.

The same refused run's CLI live-memory check saw a published 160 MiB peak
but no matching final history row. That route uses a detached watcher
process, not reserveJob's Worker; the exact flush failure is not yet reduced.

## Confirmation

The frozen sampler implementation at `4b89c4cca` completed 400 loaded
worker-memory test processes with zero native aborts. Sixteen subjects stopped
for incoming landings are excluded. Two ordinary failures are retained: an
OOM reader disappeared between FIFO open and write (EPIPE), and a partially
published ready.json failed parsing (#730). The EPIPE condition and its
deterministic closed-reader control are fixed in #735 after the frozen run.
The previous condition fails that control, while the fixed file passes.

The host audit took 4.097 seconds with separate parsing, 1.900 seconds with
shared roots, and 2.799 seconds in the final focused run. Its Worker rule borrows
the existing root before lease disposal and stores detached facts. The initial final
focused proof passed 95 tests and strict checking with no diagnostic increase.
The [tool-written summary](../worker-termination-2026-11-12.json) retains counts
and production-source hashes.

Background suite verdicts are not proof: the experiment reused its own
oracle-resolution namespace across separately stopped scopes. The holder does
not reclaim holder.json when its PID is dead. Real run directories are fresh;
no cross-run account cache interference was observed.

## Reporter lifetime

The first #735 landing passed every run-steps assertion, then failed the file
because a sampler callback appended build.log after the fixture removed its
run directory. This was a new #735 defect, not an asynchronous file stream:
runLanding passed appendFileSync as its sampler reporter. A valid final reply
followed by natural reservation completion was also misclassified as failure.

The caller sweep found 14 direct production reserveJob sites. Five scoped
owners now await closed after synchronous release: landing/run, worker-pool,
oracle-batch, oracle-dependencies and bench/build-records. The other nine are
process-lifetime jobs whose beforeExit handler drains the sampler. Natural
completion with a final reply is clean. A reporter exception rejects closed
by name and cannot escape a worker event callback.

The reporter-lifetime proof passed 133 focused tests across ten affected files.
The host audit took 3.340 seconds and strict checking found no diagnostic rise.
Removing only runLanding's await of closed made its held-shutdown control fail
with "landing returned before its owned sampler closed"; the committed owner
passed. Strict checking ran last after that mutation control.
