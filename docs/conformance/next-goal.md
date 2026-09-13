Objective: finish the modules the profile already claims before adding more, and add
the next one only in dependency order. A module at 80% hides the defects that do not
announce themselves; the last 20% is where they live.

STATE, measured 2026-09-13, so none of it is re-derived.
26 modules. child_process 101 of 120 interpreted, 0 compiled. cluster 33 of 86.
Compiled axis 49 files across 25 modules -- cluster not yet measured there.
The audit reads 142 unclaimed candidates, 179 reviewed, 0 new. Keep it at 0 new.
Every number above is `run.mjs --module <m>`; the compiled one needs `--addon`.

ORDER. What remains of the DAG:
cluster's handle distribution round_robin_handle, shared_handle, `listening`
crypto -> tls -> https and http2's TLS transport
worker_threads a second isolate: decide it as architecture, alone
Take cluster first: it is the module in flight, distribution is most of its 51
failures, and the mechanism is already proven -- a socket crosses to a worker
(`local/send-socket-local.js`). Wait for `online` before sending or the message
reaches nobody.

BEFORE THE FIRST CRYPTO BINDING, two decisions that are measured and unmade.
Provider: OpenSSL-specific assertions are tls 27/218 and crypto 29/128; the API gap
is tls 0 of 218 files, crypto 33 of 128, webcrypto 43 of 47 (nodejs.md:23287). So
`tls` does not turn on the provider question and `crypto` does. Decide with both.
Authority: `zlib`'s stand-in imports `node:zlib`, so its interpreted lane tests our
TypeScript over node's engine. For crypto that makes the lane test node against
node. Either the stand-in reaches the same provider or the lane is declared
non-authoritative for crypto and tls. Decide before the binding, not after.

THE HOLLOW CHECK HAS A BLIND SPOT, and it is not hypothetical.
`--sabotage` cannot measure a module whose tests branch on its own role. 78 of
cluster's 83 do: `if (cluster.isWorker) ... else if (cluster.isPrimary) ...`. Blank
the module and neither half runs, so every file passes having asserted nothing, and
the sabotaged run reads identical to the intact one. The harness says
"SABOTAGE DID NOT APPLY" when it notices; believe it.
When sabotage cannot distinguish, **break one thing and count what stops passing.**
Skipping cluster's handshake wiring took 22 of 25 passes with it, and the 3 that
survived name their own subject rather than being vacuous.

THE DEFECT THIS PROFILE ACTUALLY HAS is validation without plumbing. `uid`/`gid`,
`stdio` and `serialization` were each checked for type and then dropped before the
binding, so a caller asking to drop privileges got a child running as itself. None of
the three failed a test until something else did. When a module validates an option,
grep the binding for it.

AN UNANSWERED PROTOCOL MESSAGE IS A HANG. One unanswered `queryServer` held a file
for eighteen minutes before its per-file timeout. Anything this profile does not
implement must **answer**: node's worker reads `errno` off the acknowledgement and
fails at once. A named error beats silence and both beat a timeout.

RULES.
Never weaken tests, floors, or applicability rules. `build-floor.sh`'s header says
why in one line: never lower it to make a run pass. A red floor that is true is the
instrument working.
A check with no demonstrated failure is a claim. Control it by breaking the subject.
Name a number's population **and its tree and its rule** in the same breath. 350
across 11 files was the branch and 339 was main. A reach figure of 129 could not be
reproduced by any rule anyone could name, which is worse than a figure that drifted.
Measure the lane, never the sum of the files you fixed. Ten individual passes
predicted 81 and the lane read 80, because one of them came with a regression.
`grep` here is a shell function over ugrep and it silently missed a real match.
Use `awk` for any count a floor, a record, or a message to a peer rests on.
An object cannot cross the Node-API boundary; a number can. When a binding takes
one anyway, say in the declaration what the compiled lane loses by it.
A framed failure is not always the cause. `run.mjs` appends the child's stderr now
because a test that fails an assertion _and_ leaves callbacks unfired reported only
the counts, and five probes of it came back clean.
A message that has not moved across N compilers is a statement about the program.

DONE. cluster's round-robin distribution landing with `listening`, its lane measured
on both arms and the 22-of-25 control re-run; child_process's remaining 9 either
passing or each carrying a named cause in INCOMPLETE.md; the two crypto decisions
written down with both numbers beside them; and the compiled axis re-measured with
`compiled-axis.sh` so the 49 is a number from today.

## Where it stands, 2026-09-13

The DONE clause, item by item, with the numbers rather than a claim about them.

**cluster's round-robin distribution landing with `listening`** -- done, `7604a441`.

**cluster's lane measured on both arms and the control re-run** -- done.

    interpreted   86 file(s): 42 passed, 42 failed, 2 skipped
    compiled      86 file(s): 25 passed, 60 failed, 1 skipped

The control took **two** breaks, not the one this file assumed: the handshake wiring
accounts for 31 of 42, worker lifecycle state and events for 26, union **36 of 42**, and
the remaining six are listed in `cluster/INCOMPLETE.md` beside the break each would need.
`run.mjs` grew `NTS_CONFORMANCE_TIMEOUT_MS` first, because break A makes its tests wait
rather than fail and the 60s ceiling made the control cost 80 minutes and leak 26 drivers.

**child_process's remaining 9 either passing or carrying a named cause** -- done, and three
of the nine turned out to be bugs rather than causes.

    interpreted   120 file(s): 104 passed, 6 failed, 9 skipped, 1 not applicable

`send`'s `options` was validated and discarded, so `keepOpen` never reached the host; the
callback it located was dropped, and the first fix for that reported backpressure as an
error; and a handle arriving *from* a child was dropped at all four of the stand-in's
message sites. The six that remain carry mechanisms, in `child_process/INCOMPLETE.md`.

**The two crypto decisions with both numbers** -- done, `80abf5da`.

**The compiled axis re-measured so the 49 is a number from today** -- done, and it is **50**.
It read 75 for an hour and 25 of that was hollow: `cluster`'s addon exports no `default`, so
its `shape.mjs` takes the blank-module branch, `require('cluster')` returns an object with
zero keys, and every test that branches on `cluster.isWorker` / `cluster.isPrimary` takes
neither branch and passes having asserted nothing. Verified through the runner:
`KEYS=0 []`, `branch=NEITHER`.

    09-12 04:35   49 across 24 modules
    09-13 02:27   50 across 26 modules   (printed 74; tty +1, cluster's 25 hollow)
    09-13 03:5x   50 across 26 modules   (printed 75; same 25)

All of the apparent +25 was `cluster` and all of it was hollow, so the honest movement over
21 hours is `net` +2 and `tty` back to 1 -- and both of *those* minus ones were defects in
the measuring rather than in the modules: I had deleted the runner's pty harness in a commit about
stderr, and the compiler had begun emitting an addon that links and cannot load. Both are
in `docs/conformance/nodejs.md` with their brackets.

### What this leaves for next

  * **`fs` 80 and `stream` 55** -- the two largest entries in the 238 exports whose wrapper
    reports a missing function without naming a cause. Both are far larger than anything in
    the compiler's own cascade list, so the cause is upstream of that cascade and unread.
  * **cluster's six uncontrolled passes**, each wanting a break: settings, the child's
    options, an error reaching the primary, `#queryServer`.
  * **The realm seam, three verified instances in two directions** -- the child stdio
    streams and a handle received from a child need one of the host's objects to become
    one of ours; the advanced-serialization Buffer needs one of ours to become the host's
    on the way out. So it is two mechanisms, not one.

    The count was five here an hour ago, citing `atob` and `URL`. Both are recorded in the
    ledger as *absent from the compiled boundary* through a refusal cascade, which is not
    the same fact, and neither was re-read before being counted. Corrected rather than
    quietly dropped, because the wrong half of that line was the confident half.

## Where the interpreted lane stands, later on 2026-09-13

    cluster          86 file(s): 69 passed, 15 failed, 2 skipped     (from 42 this morning)
    child_process   119 file(s): 103 passed, 6 failed, 9 skipped     (119, not 120 -- see below)
    compiled axis    50 across 26 modules, measured with the per-file emptying test

`cluster` moved 42 -> 69 on seven named causes, every one of them found by diffing the pass
**set** rather than reading the total:

  * the handshake replied with an errno *name* where `getSystemErrorName` demands a negative
    number -- six files
  * `SharedHandle` was unimplemented, so udp, a caller-supplied `fd` and every non-`SCHED_RR`
    policy were answered ENOTSUP. The handle has to be the **host's**, because the worker calls
    `close` and `getsockname` on it
  * `worker.disconnect()` closed the channel instead of sending `{ act: 'disconnect' }`, so
    workers kept their bound sockets and never exited
  * `setupPrimary` never applied node's defaults and was not cumulative
  * **four events were emitted inside the call that produced them** -- `fork`, `setup`,
    `disconnect` and `send`'s callback. One cause wearing a TDZ error, a hang, a mustCall tally
    and an event nobody heard
  * `setupPrimary`, `fork` and `disconnect` were unbound, where node publishes all three as
    properties and its own tests detach every one on purpose
  * `exitedAfterDisconnect` started `false` where node starts `undefined` and coerces it at
    both departure sites

Two of those were introduced by the commit immediately before them, and one *correct* fix
needed a second correct fix to stand.

### The bookkeeping moved down, on purpose

`child_process` is 119 files rather than 120 because `test-cluster-net-send.js` was claimed by
two lanes and **disagreed with itself** -- a pass there, a failure under `cluster`, same tree,
same hour, because `cluster` substitutes `net` and `child_process` does not. Its `extra-tests`
rationale said "upstream names it for cluster, which this profile does not implement", true
when written and false from the day `cluster` landed.

`double-claimed.mjs` now finds the general case: **8 files claimed twice, 2 of them
disagreeing.** The compiled axis is not inflated by any of them and the argument is in the
ledger.

### What is left in cluster, by cause

    a fifth stdio slot          fork-stdio -- the same unimplemented feature as
                                child_process's own fork-stdio
    a received handle passes    net-send -- the handle arrives and no data flows when `net`
    no data                     is ours
    round-robin under load      disconnect, shared-leak -- two servers, echo, disconnect, repeat
    three hangs                 bind-twice, http-pipe, send-socket-local
    six unnamed                 backlog, ipv6only-false, relative-path, drop-connection,
                                send-handle-twice, uncaught-exception, kill-signal,
                                listen-fd-cluster

