"use strict";

// `OutgoingMessage` extends the legacy `Stream`, and overrides `pipe` to refuse.
//
// Both halves, because either alone is wrong. Node's chain is
//
//     OutgoingMessage -> Stream -> EventEmitter
//
// and ours was `OutgoingMessage -> EventEmitter`, so `res instanceof Stream` was
// false and `res.pipe` was undefined. Adding the base alone was measured and made
// it *worse* in one direction: ours then inherited `Stream.pipe`, which starts
// forwarding `data` events off a write-only object, where node emits
// `ERR_STREAM_CANNOT_PIPE`.
//
// Nothing upstream asserts either half. `http` runs 405 of node's files with
// nothing failing and none of them pipes a response -- on node the base cannot be
// missing and the override cannot be absent, so node's suite has nothing to check.
// Found by differencing the prototype chain against node's.

require("../common");
const assert = require("assert");
const http = require("http");
const { Stream } = require("stream");

// The base, on OutgoingMessage and on both things that inherit it.
assert.ok(http.OutgoingMessage.prototype instanceof Stream);
assert.ok(http.ServerResponse.prototype instanceof Stream);
assert.ok(http.ClientRequest.prototype instanceof Stream);
assert.strictEqual(typeof http.OutgoingMessage.prototype.pipe, "function");

// `pipe` is OutgoingMessage's own, not inherited from Stream.
assert.ok(
  Object.prototype.hasOwnProperty.call(http.OutgoingMessage.prototype, "pipe"),
  "pipe must be overridden, not inherited",
);
assert.notStrictEqual(http.OutgoingMessage.prototype.pipe, Stream.prototype.pipe);

// And it emits rather than throws, which is what node does.
{
  const message = new http.OutgoingMessage();
  let seen = null;
  message.on("error", (error) => { seen = error; });
  const destination = {
    writable: true,
    write() { return true; },
    end() {},
    on() {},
    emit() {},
    once() {},
    removeListener() {},
  };
  const returned = message.pipe(destination);
  assert.notStrictEqual(seen, null, "pipe must emit an error, not stay silent");
  assert.strictEqual(seen.code, "ERR_STREAM_CANNOT_PIPE");
  assert.strictEqual(returned, undefined);
}
