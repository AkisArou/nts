Your goal is to take `child_process` to zero failing on the interpreted lane, then `cluster`'s remaining six, measured against node's own tests.

**Where it stands, 2026-09-13.**

    net           185 files: 154 passed, 0 failed, 7 skipped, 24 n/a
    child_process 119 files: 105 passed, 4 failed, 9 skipped
    cluster        86 files:  78 passed, 6 failed, 2 skipped
    compiled axis  46 across 26 modules, emptying arm on every module
    ceiling        21 of 26; five publish nothing compiled, since an object,
                   instance, class or namespace cannot cross the N-API boundary

**child_process's four.**

    stdio-reuse-readable-stdio   the parent reads `p1.stdout` *after* `head` exits.
                                 Downstream of the lazy read that just landed, so
                                 re-diagnose it rather than assume the old cause.
    advanced-serialization       our Buffer returns from v8's structured clone as a
    ...-host-objects             Uint8Array: v8 records ours as a generic typed array
                                 and node re-wraps only its own. Measured both ways --
                                 `Map` and `bigint` in the same message survive.
    constructor                  wants `ChildProcess.prototype.spawn` published.

**Then `cluster`'s six**, each named in `cluster/INCOMPLETE.md`: `http` over a distributed pipe (plain `net` works both ways over it); a disconnect mid-handoff; `net-send`, where the child builds one of *our* sockets and node's `send` refuses it; `uncaught-exception`, priced at eleven files and refused; `listen-fd-cluster`, ENOTSOCK in the worker's `rr()`; `shared-leak`, where one worker queries so the last-holder release never fires.

**The wrapper is the proven tool for the realm seam:** `zlib`'s `ZlibNativeHandle`, then `net`'s `NetNativeHandle`, now `child_process`'s `ChildStreamHandle` -- a small object over the identifier whose methods *do* the thing. Reach for that before inventing a shape. It does not solve conversion; the Buffer needs translating.

**Method. Each line cost a wrong number.**

- Measure the lane, never add up individual passes, and diff the pass **set**: one up and one down reads as no change.
- **An object with one wrong property is a number with extra steps.** `NetNativeHandle.fd` returned the internal id and reproduced the bug the wrapper existed to fix, because node tests `typeof stdio.fd === 'number'` *before* it tests for a handle wrap.
- **node is the oracle: hook it, do not read it.** Hooking `readStart` on node settled what this tree had recorded as "a decision" for a day.
- **Assert every string replacement matched.** One that did not read as a null lane result for three commits, and a bulk `sed` rewrote five *guards* into the throw they existed to prevent.
- A condition satisfiable only once **by accident** is a missing guard: `#maybeClose` fired whenever `exited && stdioOpen === 0`, and nothing crossed that line twice until something did.
- The emptying arm runs on **every** module. Three ways to assert nothing so far: a role-branch taken neither way, an identity assertion between two absences, and a pass depending on something outside the module. All fail **open**, so an un-re-derived axis is biased upward.

**Operational.** Never `cargo`. Pin `target/release/nts`; validate the pin against a number you already have. `NTS_ADDON_OUT`, never shared `target/node`. `git commit -F <file> -- <paths>`; three sessions share one index. `/tmp` is a tmpfs and the box has rebooted three times, so `wc -l` both diff inputs first. `/usr/bin/grep` or awk for load-bearing counts; `pkill` matches your own command text. Announce shared-file changes. Run unattended.

**DONE:** `child_process` at zero failing, or every remainder carrying a named cause with its price. `cluster` at 82+ of 86, or the same. The axis re-measured from today's compiler, hollow count beside it. Every number here reproduced or corrected in `docs/conformance/nodejs.md`.
