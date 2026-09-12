'use strict';
// A primary forks a worker and hears it announce itself.
//
// On this lane the worker half is **node's own** cluster: `cluster.fork` goes through
// this profile's `child_process`, whose stand-in calls the host's `fork`, so the child is
// a plain `node <file>` with no substitution and its `require('cluster')` is node's. That
// makes this a test of our primary against node's worker -- it has to speak node's
// protocol exactly, `{ cmd: 'NODE_CLUSTER', act: 'online', seq: N }` and all -- which is
// a stronger check than talking to ourselves, and it is the same arrangement `zlib`'s
// stand-in has.
const cluster = require('cluster');

if (cluster.isWorker) {
  // node's cluster child has already announced itself by the time this runs; leaving is
  // all that is left to do.
  process.disconnect();
} else {
  const common = require('../common');
  const worker = cluster.fork();
  worker.on('online', common.mustCall(() => {}));
  worker.on('exit', common.mustCall(() => {}));
}
