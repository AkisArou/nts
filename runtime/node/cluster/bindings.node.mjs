// `cluster` has no bindings of its own, and this file exists for the ones it reaches
// through.
//
// The module is a library over `child_process` and `net`: a primary that forks workers
// and hands them server handles, and a worker that answers. Nothing in it touches the
// operating system directly, so there is no `cluster.c` and no `nts_cluster_*` to stand
// in for. What it does need is `child_process`'s stand-in loaded before its TypeScript
// runs, the way `net` imports `timers`'.
import "../child_process/bindings.node.mjs";
import "../net/bindings.node.mjs";

// The *current* process's channel, which a worker needs and `node:process` here does not
// have.
//
// A worker answers the primary through its own end of the IPC channel: `process.send`,
// `process.connected`, `process.disconnect`. Our `process` module has none of the three
// -- nothing in the profile needed them until a module could be a forked child of
// itself -- so the worker half reaches the host's, and these three names are where that
// is written down rather than hidden. When `process` grows a channel, these go.
globalThis.nts_cluster_self_connected = () => process.connected === true;
globalThis.nts_cluster_self_disconnect = () => {
  if (process.connected) process.disconnect();
};
globalThis.nts_cluster_self_send = (message) => {
  if (typeof process.send !== "function" || !process.connected) return false;
  return process.send(message) !== false;
};

// **The shared-handle half, which has to be the host's handle and not one of ours.**
//
// node's `SharedHandle` binds once in the primary and sends the *descriptor* to every
// worker. The worker is real node, and `internal/cluster/child.js` hands what arrives
// straight to its own `shared()`, which calls `handle.close` and `handle.getsockname` on
// it -- so nothing this profile could build would do. node's own factories are used
// instead, and they are the same two `SharedHandle` calls.
//
// The return convention is node's: a **number** is a negative errno and anything else is
// the handle. That is preserved across the boundary by returning the negative number as
// itself and a positive id for a handle, because only a number can cross here.
import net from "node:net";
import dgram from "node:dgram";

const sharedHandles = new Map();
let nextSharedHandle = 1;

globalThis.nts_cluster_shared_handle = (address, port, addressType, fd, flags) => {
  // **`process.noDeprecation` around this one call, and the reason is diagnosis.**
  //
  // node's own `SharedHandle` reaches the factory as `require('internal/dgram')`, which
  // is not deprecated. The public alias is -- DEP0112 -- and this stand-in has only the
  // public one. The warning goes to stderr, and `run.mjs` reports a failure's *first*
  // stderr line as its reason, so it displaced the real cause of
  // `test-cluster-disconnect-unshared-udp`: the file was already failing and the warning
  // renamed it.
  //
  // The window is one synchronous call, so nothing a test emits or asserts on is hidden.
  // That distinction matters here: `NODE_NO_WARNINGS` once hid output two tests assert
  // on, and the lesson was to narrow the suppression, not to accept the noise.
  const quiet = process.noDeprecation;
  process.noDeprecation = true;
  let rval;
  try {
    rval = addressType === "udp4" || addressType === "udp6"
      ? dgram._createSocketHandle(address, port, addressType, fd, flags)
      : net._createServerHandle(address, port, addressType, fd, flags);
  } finally {
    process.noDeprecation = quiet;
  }
  if (typeof rval === "number") return rval;
  const id = nextSharedHandle;
  nextSharedHandle += 1;
  sharedHandles.set(id, rval);
  return id;
};

// `child_process`'s `hostHandle` consults every registered resolver when it is handed
// something that is not one of our sockets. Registering rather than being special-cased
// there keeps `child_process` from having to know what `cluster` is.
globalThis.nts_host_handle_resolvers ??= [];
globalThis.nts_host_handle_resolvers.push((sent) => {
  if (sent === null || typeof sent !== "object") return undefined;
  if (typeof sent.ntsClusterHandle !== "number") return undefined;
  return sharedHandles.get(sent.ntsClusterHandle);
});

globalThis.nts_cluster_shared_handle_close = (id) => {
  const handle = sharedHandles.get(id);
  if (handle === undefined) return;
  sharedHandles.delete(id);
  // `close` is the raw handle's, not a socket's. A handle the primary bound and no worker
  // holds any more keeps the loop alive on its own.
  if (typeof handle.close === "function") handle.close();
};
