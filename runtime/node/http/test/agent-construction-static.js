"use strict";

// Supported behavior retained from pinned upstream:
//   test-http-agent-close.js
//   test-http-agent-keepalive-delay.js
//   test-http-agent.js
// Those files inject behavior by replacing instance/prototype methods at
// runtime. A statically typed program expresses the same extension as a class
// override, which is the contract exercised here.
const common = require("../common");
const assert = require("assert");
const http = require("http");

const connectionError = new Error("connection failed");

class FailingAgent extends http.Agent {
  createSocket(_request, _options, callback) {
    callback(connectionError);
  }
}

const failed = http.request({ agent: new FailingAgent() });
failed.on(
  "error",
  common.mustCall((error) => {
    assert.strictEqual(error, connectionError);
  }),
);
failed.on(
  "close",
  common.mustCall(() => {
    assert.strictEqual(failed.destroyed, true);
  }),
);

class InspectingAgent extends http.Agent {
  createConnection(options, callback) {
    assert.strictEqual(options.noDelay, true);
    assert.strictEqual(options.keepAlive, true);
    assert.strictEqual(options.keepAliveInitialDelay, this.keepAliveMsecs);
    return super.createConnection(options, callback);
  }
}

const agent = new InspectingAgent({ keepAlive: true, keepAliveMsecs: 1234 });
const server = http.createServer(
  common.mustCall((_request, response) => {
    response.end("ok");
  }),
);

server.listen(
  0,
  common.mustCall(() => {
    http.get(
      { port: server.address().port, agent },
      common.mustCall((response) => {
        response.resume();
        response.on(
          "end",
          common.mustCall(() => {
            agent.destroy();
            server.close();
          }),
        );
      }),
    );
  }),
);
