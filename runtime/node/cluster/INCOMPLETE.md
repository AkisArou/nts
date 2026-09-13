# `cluster`, the handshake and nothing beyond it

The 26th module. On `main` and counted, with most of its corpus failing, and the number
below is worth less than the paragraph after it.

## Where it is

    interpreted   86 file(s): 41 passed, 43 failed, 2 skipped, 0 not applicable

84 by `test-pattern`, 1 claimed in `extra-tests`, 2 local fixtures. The claimed one --
`test-listen-fd-cluster.js` -- fails, and claiming a failing test is the honest direction:
its subject is this module's handle distribution, so it belongs in the denominator.

## `--sabotage` cannot measure this module, and that had to be established first

The goal text asks for `--sabotage` on a new module showing 0 hollow. **It cannot show
it here, and not because the module is hollow.** 78 of the 83 upstream cluster tests
branch on the module's own role:

    if (cluster.isWorker) { ...the worker half... } else if (cluster.isPrimary) { ... }

With the module blanked, both guards are falsy, **neither half runs, and the file passes
having asserted nothing**. 13 are written with that exact `else if`; the rest reach the
same place by other routes. So a sabotaged run reads 25 passed -- identical to the intact
run -- and means nothing at all.

The harness said so itself rather than letting it pass for coverage:

    SABOTAGE DID NOT APPLY: every file passed with the module blanked, which
    means it was probably not blanked.

That message is the only reason those 25 were not read as evidence. A module whose tests
select their own subject cannot be measured by removing the subject.

## So the control breaks one thing instead of blanking everything

Re-run on 2026-09-13 against the current lane -- **86 files: 42 passed, 42 failed, 2
skipped** -- and with two breaks rather than one, because one break left too much
uncontrolled once round-robin distribution landed.

    break A   the handshake wiring: `fork` returns a worker whose internal
              channel is never listened to
                  31 of 42 stop passing

    break B   the worker's own lifecycle: no `dead` or `disconnected` state and
              no `exit` or `disconnect` events. `#releaseWorker` and the
              workers-map delete stay, so nothing wedges for a reason unrelated
              to the subject
                  26 of 42 stop passing

    A or B    36 of 42 stop passing

**Six passes are controlled by neither, and each is named with the break it would need**,
because an uncontrolled pass that nobody lists is indistinguishable from a hollow one:

    setup-primary-emit, setup-primary-multiple   subject is `setupPrimary` and the
                                                 `setup` event -- wants a break in
                                                 settings
    cwd, fork-env                                subject is what `fork` passes down --
                                                 wants a break in the child's options
    eaddrinuse                                   subject is an error reaching the
                                                 primary
    rr-handle-keep-loop-alive                    subject is distribution holding the
                                                 loop open -- wants a break in
                                                 `#queryServer`

So 36 of the 42 passes are demonstrated to depend on this module working. The earlier
figure in this file was 22 of 25 against a 25-pass lane, from break A alone; break A now
accounts for 31 and the gap it leaves is 11, which is why there are two.

### The control had to be made cheap before it could be re-run

Break A does not make its tests *fail*, it makes them **wait**: the primary never acks, so
every worker hangs to the per-test ceiling. At 60s that is 80 minutes for a number decided
in the first few seconds, and worse, each timeout leaked its driver -- 26 `run-one.mjs`
processes were alive at once with their forked workers behind them, on a box where long node
runs die. `run.mjs` now reads `NTS_CONFORMANCE_TIMEOUT_MS`.

A shortened ceiling is only sound if it is not itself the variable, so the intact arm was
re-run at 20s first: **42 passed, and the pass set byte-identical to the 60s arm, 0 files
different**. Only then do the broken arms' counts mean anything.


## The compiled lane publishes nothing, and its 25 passes were all hollow

    interpreted   86 file(s): 42 passed, 42 failed, 2 skipped
    compiled      86 file(s): 25 printed, and every one of them asserted nothing

`shape.mjs` reads `exports.default`. The addon exports no `default` -- its six keys are
`SCHED_NONE SCHED_RR isMaster isPrimary isWorker schedulingPolicy` -- so `shape` reaches
its blank-module branch and returns `{}`. Through the runner:

    compiled     require('cluster') -> KEYS=0 []      branch=NEITHER
    interpreted  require('cluster') -> KEYS=12 [...]  branch=primary

Every role-guarded file therefore takes neither branch. **This is the hollowness the
`--sabotage` section above describes, arriving on a lane where nothing was sabotaged**, and
the comment in `shape.mjs` had already named it: a blanked module publishes nothing.

It is not obvious that this is fixable here. What node publishes from `lib/cluster.js` is a
single EventEmitter **instance**, and an instance is exactly what the Node-API boundary
declines -- the same wall `child_process`'s `send` hit with an object parameter, and
`child_process` is likewise at 0. So the honest compiled row for this module is **0**, and a
25 in its place was a number about the harness.

The two-break control above was run on the interpreted arm. It says nothing about the
compiled one, where the break has nothing to bite: a module with no surface cannot be
observed losing part of it.

And `--sabotage`'s own instrument settles it, on the lane where it *can* be applied
meaningfully, because the module is already blank there:

    compiled, intact           86 file(s): 25 passed, 60 failed, 1 skipped
    compiled, --empty-exports  86 file(s): 25 passed, 60 failed, 1 skipped

Identical in all three columns. The module contributes nothing to that row. Controlled the
same way, the other small compiled surfaces are real: `stream`'s single pass and
`querystring`'s single pass both fall to **0** when their module is emptied, so a small
surface is not by itself a hollow one -- an absent one is.

## What is here

The handshake, and it is the whole of the module. A primary forks a child with
`NODE_UNIQUE_ID` in its environment; the child announces itself with
`{ cmd: 'NODE_CLUSTER', act: 'online', seq: N }`; the primary sets the worker's state and
emits `online` on the worker and on itself. Then `Worker` -- `send`, `kill`, `destroy`,
`disconnect`, `isConnected`, `isDead` -- `fork`, `settings`, `setupPrimary`, `workers`,
`disconnect`, and the two scheduling constants.

### The worker half is node's own, and that is the stronger arrangement

`cluster.fork` goes through this profile's `child_process`, whose stand-in calls the
host's `fork`, so the child is a plain `node <file>` with no substitution and its
`require('cluster')` is **node's**. Every cluster test on this lane is therefore *our
primary against node's worker*: ours has to speak node's protocol exactly, byte for byte,
rather than agreeing with itself. That is the same arrangement `zlib`'s stand-in has and
it is worth more here than a closed loop would be.

It also means `NODE_UNIQUE_ID` reads as `undefined` inside the child: node's cluster child
deletes it after reading, so grandchildren are not workers. That cost a diagnostic round
before it was understood.

## What is absent, and what it costs

**The shared-descriptor path.** `shared_handle` -- what node uses when
`schedulingPolicy` is `SCHED_NONE`, and for `udp4`/`udp6` always, because a datagram
address has no connections to distribute. A worker asking for one gets `ENOTSUP` on the
acknowledgement, so it fails at once rather than waiting.

**A descriptor passed in as `fd`.** `queryServer` with `fd >= 0` is answered the same way.

Round-robin distribution **is** here: the primary binds the address once, accepts, and
hands each connection to the next free worker, queueing when none is free and putting a
connection back if a worker refuses it. `listening` reaches the worker and cluster.

### Two things that had to be right for it to work at all

**A listener outlives its last worker unless something releases it.** A worker that leaves
by exiting rather than by closing its server never sends `close`, so the listening socket
stays open, the event loop stays alive, and the process hangs *after the test has already
passed*. That reads as "an exit handler failed" and not as a leak, and it cost a run at
exit code 124 before it was understood. A departing worker now releases every address it
held.

**A negative port means a path, not a host.** node's own RoundRobinHandle branches the
same way. Listening on port -1 broke `test-cluster-listen-pipe-readable-writable`, which
had been *passing* on the ENOTSUP that used to come back instead -- a pass that improved
into a failure, which is the shape worth watching for when a stub becomes an
implementation.
