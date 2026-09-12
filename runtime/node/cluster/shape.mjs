// The object `node:cluster` publishes, which is one of two objects.
//
// node's `lib/cluster.js` requires `internal/cluster/primary` or `internal/cluster/child`
// depending on `NODE_UNIQUE_ID`, so the module a program receives *is* one role. The two
// surfaces differ: a primary publishes 16 names and a worker 10, overlapping in `Worker`,
// `isMaster`, `isPrimary`, `isWorker` and the EventEmitter's own. This trims the single
// exported instance to whichever role the process is in, so `'fork' in cluster` answers
// false in a worker exactly as it does on node -- a feature-detecting program must not be
// told a worker can fork.
export function shape(exports) {
  const cluster = exports.default;
  // `--sabotage` hands this a blank object, and reading a role off `undefined` threw --
  // which made the *shaping* fail rather than the module, so the runner fell back and the
  // tests ran against node's own cluster and all passed. The harness said so in as many
  // words ("SABOTAGE DID NOT APPLY: every file passed with the module blanked"), and that
  // message is the only reason the 25 passes were not read as coverage. A blanked module
  // publishes nothing.
  if (cluster === undefined || cluster === null) return {};

  // The instance is an EventEmitter and its methods live on the prototype, so the
  // published object is the instance itself with the wrong role's names removed rather
  // than a copy: a copy would lose `on`, `emit` and the listener state with them.
  const primaryOnly = ["SCHED_NONE", "SCHED_RR", "fork", "disconnect", "schedulingPolicy",
                       "settings", "setupMaster", "setupPrimary", "workers"];
  const workerOnly = ["worker", "_getServer", "_setupWorker"];
  const drop = cluster.isPrimary ? workerOnly : primaryOnly;
  for (const name of drop) {
    if (Object.prototype.hasOwnProperty.call(cluster, name)) delete cluster[name];
  }
  return cluster;
}
