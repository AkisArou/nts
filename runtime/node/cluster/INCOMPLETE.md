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

The handshake wiring was skipped -- `fork` returns a worker whose channel is never
listened to -- and the 25 were re-run:

    22 of 25 stop passing
     3 still pass: setup-primary-emit, setup-primary-multiple, eaddrinuse

The three are not vacuous: their subject is `setupPrimary` and the `setup` event, which
this break does not touch. They would need their own break to be controlled, and that is
a gap in the control rather than in them.

**So 22 of the 25 passes are demonstrated to depend on this module working**, which is
what the hollow requirement is actually asking, arrived at the way the rules say: control
it by breaking the subject.

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
