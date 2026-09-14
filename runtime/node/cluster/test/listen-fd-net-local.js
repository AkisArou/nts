'use strict';
// `listen({ fd })` through a cluster primary, with a **plain `net` consumer** in the worker.
//
// This is the control arm for `test-listen-fd-cluster`, which is the same three-process
// arrangement with node's `http` server in the worker and which fails with its request
// handler never running. The only difference here is what consumes the delivered
// connection, so the pair separates two causes that the upstream failure cannot:
//
//   * the primary never delivers the connection    -> both arms fail
//   * the primary delivers something node's `http` server will not read from -> only
//     the upstream arm fails, and this one passes
//
// The second outcome would also tie this file to `test-cluster-http-pipe`, whose symptom
// is identical ("request handler never runs") and whose own control arm already showed
// plain `net` over a distributed **pipe** working. One cause wearing two test names.
//
// The process shape is upstream's, because it is the thing under test:
//
//   parent: this file with no argument -- binds a real listening socket and hands the
//           descriptor to the primary as stdio slot 3, then closes its own copy
//     -> primary: `cluster.setupPrimary({ args: ['worker'] })` and one `fork()`
//          -> worker: `listen({ fd: 3 })`, which in a worker is not a bind at all but a
//             `queryServer` to the primary, who binds **its** fd 3 and round-robins
//
// Re-spawning this file re-enters the conformance runner, because `nodeTestTarget`
// accepts a sibling of the fixture, so all three processes carry this profile's `cluster`.
const assert = require('assert');
const net = require('net');
const cluster = require('cluster');

console.error('role:', process.argv[2] || 'runner');

if (process.argv[2] === 'primary') {
  primary();
} else if (process.argv[2] === 'worker') {
  worker();
} else {
  runner();
}

function runner() {
  const common = require('../common');
  let ok = false;
  process.on('exit', () => { assert.ok(ok, 'the worker never served the connection'); });

  const server = net.createServer((conn) => {
    // Reaching here means the **parent's** server accepted, which it cannot once it has
    // closed its copy -- it would mean the descriptor never moved.
    console.error('connection on parent');
    conn.end('hello from parent\n');
  });

  server.listen(0, () => {
    const port = server.address().port;
    console.error('parent listening on', port);
    const primaryProc = require('child_process').spawn(
      process.execPath,
      [__filename, 'primary'],
      { stdio: [0, 'pipe', 2, server._handle, 'ipc'], detached: true },
    );
    // Close the parent's copy so the primary holds the only reference. Connections still
    // arrive, because the primary has the same descriptor open.
    server.close();

    primaryProc.on('message', common.mustCall((msg) => {
      if (msg !== 'started worker') return;
      console.error('worker is up; connecting');
      let seen = '';
      const conn = net.connect(port);
      conn.on('data', (chunk) => { seen += chunk.toString(); });
      conn.on('end', common.mustCall(() => {
        primaryProc.kill();
        primaryProc.on('exit', common.mustCall(() => {
          assert.strictEqual(seen, 'hello from worker\n');
          ok = true;
        }));
      }));
    }));
  });
}

function primary() {
  cluster.setupPrimary({ args: ['worker'] });
  const worker = cluster.fork();
  worker.on('message', (msg) => {
    if (msg === 'worker ready') process.send('started worker');
  });
  // Upstream's guard against outliving an abnormally killed parent.
  process.on('disconnect', () => { process.exit(0); });
}

function worker() {
  const server = net.createServer((conn) => {
    console.error('connection on worker');
    conn.end('hello from worker\n');
  });
  server.listen({ fd: 3 }, () => {
    console.error('worker listening on fd=3');
    process.send('worker ready');
  });
}
