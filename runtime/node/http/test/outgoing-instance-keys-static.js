"use strict";

// Five internal fields that were own enumerable keys on every `ServerResponse`
// and `ClientRequest`, and node's `OutgoingMessage` has none of them.
//
//     headersMap  hasBody  statusLine
//     keepAliveWithoutFramingWhenEmpty  _maxRequestsPerSocket
//
// Each was declared `protected` or with an `_` prefix, and neither hides a field
// at runtime -- `protected` is a TypeScript modifier and compile-time only. They
// are symbol-keyed now, which is what node reaches for in the same situation
// (`kOutHeaders`, `kHighWaterMark`) and for the same reason: reachable from a
// subclass in another file, invisible to `Object.keys`.
//
// A `#` field would have hidden them and could not be used: `ClientRequest` writes
// three of them from `client.ts`, and `server.ts` writes the fifth onto a response
// from outside the class entirely.
//
// Named individually rather than asserting the whole key set equals node's,
// because two differences remain and both are deliberate. `_highWaterMark` is one
// node's own tests read off a real request, and `writableEnded`/`writableFinished`
// are prototype getters on node and declared fields here -- the object model,
// which `process/test/export-surface-static.js` already records.

require("../common");
const assert = require("assert");
const http = require("http");

const REMOVED = [
  "headersMap",
  "hasBody",
  "statusLine",
  "keepAliveWithoutFramingWhenEmpty",
  "_maxRequestsPerSocket",
];

for (const Class of [http.OutgoingMessage, http.ServerResponse, http.ClientRequest]) {
  const keys = Object.keys(Class.prototype);
  for (const name of REMOVED) {
    assert.strictEqual(
      keys.includes(name),
      false,
      `${Class.name}.prototype must not enumerate ${name}`,
    );
  }
}

const message = new http.OutgoingMessage();
for (const name of REMOVED) {
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(message, name),
    false,
    `an OutgoingMessage must not carry ${name} as an own key`,
  );
}

// The behaviour those fields carry still works, which is what a symbol key could
// have broken: a response knows whether it has a body and what its status line is.
const response = new http.ServerResponse({ method: "GET" });
response.statusCode = 404;
assert.strictEqual(typeof response.writeHead, "function");
assert.strictEqual(response.statusCode, 404);
