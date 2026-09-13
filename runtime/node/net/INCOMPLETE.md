# `net`: what is not here, and why

## `_handle` is a number, and node's is an object

    ours   typeof server._handle === 'number'   value 1
    node   typeof server._handle === 'object'   constructor TCP

Measured both ways. The number is this module's own handle id, which the binding owns; node's
is a libuv wrap with `close`, `readStart`, `getsockname` and the rest on it.

### What it costs, and how it was found

Two files fail on the interpreted lane and **pass hollowly on the compiled one**:

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

### Why it is not a small fix

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

So the object would need the number inside it and both of those updated in the same change,
and every other reader of `_handle` in this module's 185 files re-measured. It is worth doing
and it is not worth doing halfway: an object that answers `close` but not `getsockname` trades
one confusing failure for another.

### The smaller thing that is true regardless

The two compiled passes should not be counted. `compiled-axis.sh` runs the emptying arm for
every module now rather than only for modules that publish nothing, which is what let these
two through -- `net` publishes 10 names, so it was exempt from the test that catches them.
