// `localAddress`, `localPort` and `localFamily` are read from the handle, so they go when it does.
// `remoteAddress` does not: node caches the peer and keeps answering it.
//
// node defines the three local getters over `this._getsockname()`, and `_getsockname()` answers
// `{}` when `!this._handle` — so after a socket is destroyed all three are `undefined`. The peer
// is cached in `_peername` and survives. The asymmetry is node's, it is observable, and this
// profile cached both halves so all three outlived the handle:
//
//     after close   node   local=undefined  lport=undefined  lfam=undefined  remote="127.0.0.1"
//                   ours   local="127.0.0.1" lport=38776     lfam="IPv4"     remote="127.0.0.1"
//
// Found by adding a socket round trip to `differential-corpora.mjs`. It is **not** compared there:
// read in a `close` handler, node answers these in a standalone program and answers nothing under
// the differential — same code, same input, different arrangement, because its post-destroy
// reporting depends on when the handler runs relative to internal cleanup. A field that is not a
// function of the input cannot be compared against another implementation. So the fuzz dropped
// them and this controls the timing instead.
"use strict";

const common = require("../common");

const assert = require("assert");
const net = require("net");

const finished = common.mustCall(() => {});

const server = net.createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", () => socket.end(Buffer.concat(chunks)));
});

server.listen(0, "127.0.0.1", common.mustCall(() => {
  const client = net.connect({ host: "127.0.0.1", port: server.address().port }, common.mustCall(() => {
    // While the handle is live, all four answer.
    assert.strictEqual(typeof client.localAddress, "string", "localAddress while connected");
    assert.strictEqual(typeof client.localPort, "number", "localPort while connected");
    assert.strictEqual(typeof client.localFamily, "string", "localFamily while connected");
    assert.strictEqual(client.remoteAddress, "127.0.0.1");

    client.end("x");
  }));

  client.resume();

  client.on("close", common.mustCall(() => {
    // The handle is gone: the three local fields go with it.
    assert.strictEqual(client.localAddress, undefined, "localAddress must not outlive the handle");
    assert.strictEqual(client.localPort, undefined, "localPort must not outlive the handle");
    assert.strictEqual(client.localFamily, undefined, "localFamily must not outlive the handle");

    // And the peer, which node caches, is still there. This is the control: if the getters simply
    // returned `undefined` unconditionally, every assertion above would pass and this would fail.
    assert.strictEqual(client.remoteAddress, "127.0.0.1",
      "remoteAddress is cached by node and must survive the handle");

    server.close(common.mustCall(() => { finished(); }));
  }));
}));
