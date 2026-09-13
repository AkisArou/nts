# `net`: what is not here, and why

## Nothing, on the interpreted lane, as of 2026-09-13

    185 file(s): 154 passed, 0 failed, 7 skipped, 24 not applicable

All three failures this file was written to describe are fixed. The account of the `_handle`
seam is kept below because the reasoning outlived the bug: it explains why `_handle` is an
object, why both dependents had to move with it, and one trap that is easy to walk back into.

## `_handle` is an object, as node's is -- and `fd` must be the real descriptor

    ours (before)  typeof server._handle === 'number'   value 1
    ours (now)     NetNativeHandle { identifier, server, fd, handle, close, ... }
    node           typeof server._handle === 'object'   constructor TCP

### What it cost, and how it was found

Three files failed on the interpreted lane, two of them also **passing hollowly on the
compiled one**:

    test-listen-fd-detached.js           compiled: 1 passed   emptied: 1 passed
    test-listen-fd-detached-inherit.js   compiled: 1 passed   emptied: 1 passed

Identical with the module emptied, so neither compiled pass asserts anything. They were found
by an instrument flagging them **INVERTED** -- passing compiled, failing interpreted -- and the
reasoning behind that label is the useful part: both lanes are built from the same TypeScript,
so a pass on one with a failure on the other means the pass holds for a reason other than the
one it states, and the *passing* half is the suspicious one.

The interpreted failure has one cause. The test's parent does

    spawn(process.execPath, [__filename, 'child'], {
      stdio: [ 'ignore', 'ignore', 'ignore', server._handle ],
      detached: true,
    });

and hands the child its listening socket as stdio slot 3. With `_handle` a number, what gets
passed is the **number 1** -- which the host reads as *file descriptor 1*, the parent's stdout.
The child then listens on a descriptor that is not a socket and the test's HTTP request to the
reported port never completes: `anonymous was called 0 times, expected 1`, naming nothing.

### Why it was not a small fix

**The representation is ambiguous, not merely wrong.** `stdio: [0, 1, 2]` is a legitimate
descriptor array, and a bare number cannot be distinguished from one. A resolver keyed on the
value cannot tell `server._handle` from `1`.

Making `_handle` an object is the real answer and it is a change to this module's published
shape, not an addition. Things already read it as a number:

  * `cluster`'s round-robin handoff maps `socket._handle` to the host's raw handle through
    `nts_net_host_socket`, which is keyed by that number. Three of `cluster`'s passes depend
    on it.
  * `child_process`'s `hostHandle` tests `typeof sent._handle === "number"` to recognise one
    of our sockets at all.

Both were updated in the same commit, which was not optional: either left alone stops
recognising every socket, and an unrecognised socket is sent as itself.

### The trap, which cost a commit and is easy to walk back into

node's `getValidStdio` tests `typeof stdio.fd === 'number'` **before** it tests for a handle
wrap. So a wrapper answering `fd` with its internal identifier is read as *that descriptor* and
the handle branch is never reached -- reproducing the exact bug the wrapper exists to fix.
Measured: `fstatSync(3).isFIFO()` true with the wrapper's id, `isSocket()` true with the host
handle. **`fd` must be the real descriptor**, and `-1` where there is no host object.

### The two compiled passes are still not counted

`compiled-axis.sh` runs the emptying arm for every module now rather than only for modules that
publish nothing, which is what let those two through -- `net` publishes 10 names, so it was
exempt from the test that catches them. They pass interpreted for a real reason now; whether
they pass compiled for one is a separate question the emptying arm still answers.
