# `cluster`, the handshake and nothing beyond it

The 26th module. On `main` and counted, with most of its corpus failing, and the number
below is worth less than the paragraph after it.

## Where it is

    interpreted   89 file(s): 83 passed, 4 failed, 2 skipped, 0 not applicable

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

    interpreted   89 file(s): 83 passed, 4 failed, 2 skipped
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


## Two closed by one line, and the price on one of them had been wrong

`http-pipe` and `listen-fd-cluster` were recorded here as two files with two causes. They were
one, and it was not in this module.

    interpreted   89 file(s): 83 passed, 4 failed, 2 skipped     (was 78 / 6)

### What the wrong price looked like

`listen-fd-cluster` was priced as *"the descriptor the worker is given is not a socket by the time
it binds"*, from an observed `bind ENOTSOCK`. That is false, and a probe with no cluster in it at
all says so: `server._handle` through stdio slot 3 arrives in the child as the **same** listening
socket -- same port, accepts, data flows, byte-identical to node.

`http-pipe` was priced at *"one more arm, comparing what node's `http` server reads off a
connection it accepted itself against one delivered as a `newconn` handle"*. That arm was the
right idea and the wrong subject: what mattered was not what `http` reads but **when**.

### The arm that found it separated read from write

The first control here used a plain `net` consumer in the worker and passed -- and it passed by
only ever *writing*. Adding a worker that reads first, on the identical handoff:

    worker only writes                        served, data flows
    worker reads, client writes on connect    `connection`, `end`, and no data
    worker reads, client writes 300ms later   `worker read "ping"`

The third arm is the proof. The descriptor is right, the read direction works, and only the timing
was wrong -- which is why every HTTP client fails on it, since they all write on `connect`, and why
a `net` consumer that answers first never noticed.

### The cause was under the module seam, and our side looked innocent

`adoptAt` in `net/bindings.node.mjs` claimed *"Paused until the module asks: nothing should arrive
before `read_start`"* and called `socket.pause()`. node's `Socket.prototype.pause` calls
`readStop()` only when `this[kBuffer]` is set, and `kBuffer` exists only for a socket built with
the `onread` option. So the accepted socket's constructor `read(0)` armed libuv and the host socket
read on **below** the seam, into a buffer nothing above ever looks at. The primary then hands the
descriptor to a worker one IPC round trip later, by which time the bytes are gone.

At handoff the primary's own `Socket` reports `bytesRead=0`, `readableLength=0`, `flowing=false`.
Everything visible from inside this module was clean, which is why looking here found nothing.

The fix is `pauseOnConnect: true` on both sides of the seam -- the stand-in's host server, which is
the line that moves the files, and this module's distribution server, so the primary's `Socket`
never resumes either. node reaches the same end differently: `RoundRobinHandle` steals the
listening handle and installs its own `onconnection`, so no `Socket` exists in a primary at all.

### An instrument that fixed the bug it was measuring

A `console.error` in `#handoff` made the failing fixture pass, every time. Two synchronous writes
were enough latency for the handoff to win the race. Anything timing-shaped here has to be measured
without adding a print, and the three fixtures do that by moving the client's write instead.

## The four that remain, each with a cause and a price

    interpreted   89 file(s): 83 passed, 4 failed, 2 skipped

### `net-send` -- the child holds one of *our* sockets and node's `send` refuses it

The child's `process.send('handle', socket)` throws before anything crosses:

    ERR_INVALID_HANDLE_TYPE: This handle type cannot be sent
      at target._send (node:internal/child_process:848)
      at #completeConnection (runtime/node/net/src/main.ts:1189)

The bottom frame is the finding: the socket came from **this profile's `net`**, which `cluster`'s
lane substitutes and `child_process`'s does not -- the same file passes there.

node dispatches on identity and nothing else:

    if (handle instanceof net.Socket) ... else if (handle instanceof net.Server) ...
    else if (handle instanceof TCP || handle instanceof Pipe) ...
    else throw new ERR_INVALID_HANDLE_TYPE();

**Price: patching the host's `net.Socket[Symbol.hasInstance]`** so node's `instanceof` accepts one
of ours. The child is real node and its `process.send` is node's own, so there is no seam of ours
to intervene at -- the only lever is changing what the host's `instanceof` answers, for all host
code, from a stand-in. That is a larger change to someone else's semantics than the file is worth,
and it is why this is recorded rather than done.

A cluster *worker* is unaffected and that was checked rather than assumed, since this module's
design rests on it: a worker reports `nts_cluster_self_send` undefined and carries node's own
`_getServer`.

### `net-server-drop-connection` -- a disconnect mid-handoff

Three workers on one pipe, ten connections, and the workers disconnected while connections are
still being counted. The single-worker pipe case works.

**Price:** `#handoff` parks a socket against its sequence number so a refusal can put it back, and
**no passing test exercises that path**. Pricing it means writing the control first -- a fixture
that refuses a handoff deliberately -- because a fix to an unexercised path cannot be shown to
work. The `pauseOnConnect` change above did not move this file, which is worth knowing: it is not
another instance of the same race.

### `shared-leak` -- w1 does not exit, and two hypotheses are dead

Both workers reach `queryServer` and report `listening`; w2 exits 0; the workers map reaches zero;
the primary sits on a bound socket. Two explanations tested and refuted:

  * **Not "only one worker queries."** Traced; both do. An earlier note here said otherwise.
  * **Not our `net` missing a peer FIN.** An unread socket does not close on a peer FIN -- *on node
    either*, measured with one fixture on both lanes.

**Price:** why w1 does not exit once its server handle is closed and its accepted socket is
half-closed. A shared descriptor is now closed when the workers map empties, which is node's
`removeWorker` condition, and it did not move this file -- so the remaining hold is inside the
worker, which is node's own code, and pricing it means instrumenting node's `child.js` rather than
ours.

### `uncaught-exception` -- priced at eleven files, and refused

`run-one.mjs` hands an escaped exception only to a module that declares the hook, and `process`
owns it. Adding `process` to this module's `uses`:

    86 file(s): 66 passed, 18 failed    (against 78 / 6)

**Eleven files lost, none gained.** Substituting `process` changes what a primary *is* far more
than it changes what one throw does. Reverted; the price is the record.

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
