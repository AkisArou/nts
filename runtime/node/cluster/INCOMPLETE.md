# `cluster`, the handshake and nothing beyond it

The 26th module. On `main` and counted, with most of its corpus failing, and the number
below is worth less than the paragraph after it.

## Where it is

    interpreted   85 file(s): 25 passed, 58 failed, 2 skipped, 0 not applicable

84 by `test-pattern`, 1 claimed in `extra-tests`, 1 local fixture. The claimed one --
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

**Handle distribution.** `round_robin_handle` and `shared_handle` -- a worker calling
`listen()` asks the primary for a server handle, and the primary either shares the
descriptor or accepts connections itself and passes sockets over the channel. That is the
half of `cluster` that makes it worth having, and with it go `listening`, most of the 57
failures, and any test that binds a port.

An unimplemented act is **answered** rather than ignored, and that was not cosmetic: an
unanswered `queryServer` left `test-cluster-bind-twice` running for eighteen minutes
before its per-file timeout, because node's worker waits for the acknowledgement. Now any
act this module does not implement gets `{ ack: seq, errno: 'ENOTSUP' }`, which node's
worker turns into an error at once.

**A worker's own channel comes from the host.** `node:process` in this profile has no
`send`, `connected` or `disconnect` -- nothing needed them until a module could be a
forked child of itself -- so `nts_cluster_self_*` reach the host's three, named in
`bindings.node.mjs` rather than hidden. They go when `process` grows a channel.
