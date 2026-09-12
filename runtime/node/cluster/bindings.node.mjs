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
