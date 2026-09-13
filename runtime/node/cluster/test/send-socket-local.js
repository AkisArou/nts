'use strict';
// A primary hands an accepted connection to a worker.
//
// The one mechanism round-robin scheduling is built on, and it crosses two module
// boundaries: the socket is this profile's `net.Socket`, which is a **number** on the
// binding boundary, so `child_process`'s stand-in turns that number back into the host
// socket the host's `child.send(message, handle)` requires. Proven before the distribution
// logic was written, because if a socket cannot cross there is nothing to build.
//
// **Wait for `online` first.** Sending before the worker has announced itself means
// sending before node's cluster child has installed its own message handling, and the
// message is delivered to nobody -- which cost a diagnostic round and looks exactly like
// a socket that failed to cross.
const cluster = require('cluster');

if (cluster.isWorker) {
  process.on('message', (message, handle) => {
    if (message !== null && typeof message === 'object' && message.probe === 'have-socket') {
      process.send({ probe: 'worker-saw', got: handle !== undefined && handle !== null });
      // **Destroy what arrived, or this worker never exits -- and that is correct.**
      //
      // `worker.disconnect()` is graceful: node's `child.js` closes the handles *cluster*
      // gave it and then closes the channel, and a worker whose loop still holds an open
      // socket keeps running. A socket sent over the channel by hand is not one of
      // cluster's handles, so nothing else will close it.
      //
      // This fixture asserted `worker.on('exit')` and passed for a year on the opposite
      // mechanism: `disconnect` used to close the channel from the primary, and node's
      // `process.once('disconnect')` then calls `process.exit` because
      // `exitedAfterDisconnect` was never set. Fixing `disconnect` to send
      // `{ act: 'disconnect' }` -- which is what node does -- made this fixture hang, and
      // the fixture was the thing that was wrong.
      handle?.destroy();
    }
  });
} else {
  const common = require('../common');
  const assert = require('assert');
  const net = require('net');

  const worker = cluster.fork();
  worker.on('online', common.mustCall(() => {
    const server = net.createServer(common.mustCall((socket) => {
      assert.strictEqual(worker.send({ probe: 'have-socket' }, socket), true);
    }));
    server.listen(0, common.mustCall(() => {
      net.connect(server.address().port);
    }));
    worker.on('message', common.mustCall((message) => {
      assert.strictEqual(message.probe, 'worker-saw');
      assert.strictEqual(message.got, true, 'the worker received a handle');
      server.close();
      worker.disconnect();
    }));
  }));
  worker.on('exit', common.mustCall());
}
