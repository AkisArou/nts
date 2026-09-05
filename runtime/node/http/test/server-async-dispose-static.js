"use strict";

// Public portion of upstream test-http-server-async-dispose.js. The upstream
// suffix inspects `_http_server.kConnectionsCheckingInterval` and the private
// Timeout `_destroyed` field; neither is part of node:http's public contract.
const common = require("../common");
const assert = require("assert");
const { createServer } = require("http");

const server = createServer();

server.listen(
  0,
  common.mustCall(() => {
    server.on("close", common.mustCall());
    server[Symbol.asyncDispose]().then(
      common.mustCall(() => {
        assert.strictEqual(server.address(), null);
      }),
    );
  }),
);
