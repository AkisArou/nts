"use strict";

// Public behavior retained from pinned upstream
// test-http-destroyed-socket-write2.js. That mixed fixture ends by inspecting
// ClientRequest.outputData, Node's private JavaScript write queue; this one
// keeps the public response ownership and torn-transport error contract.
const common = require("../common");
const assert = require("assert");
const http = require("http");

const responseDestroyed = Symbol("responseDestroyed");

const server = http.createServer(
  common.mustCallAtLeast((request, response) => {
    request.on(
      "data",
      common.mustCall(() => {
        response.destroy();
        server.emit(responseDestroyed);
      }),
    );
  }),
);

server.listen(
  0,
  common.mustCall(() => {
    const request = http.request({
      port: server.address().port,
      path: "/",
      method: "POST",
    });

    server.once(
      responseDestroyed,
      common.mustCall(() => {
        request.write("hello");
      }),
    );

    request.on(
      "error",
      common.mustCall((error) => {
        assert.strictEqual(request.res, null);
        assert(
          ["ECONNRESET", "ECONNABORTED", "EPIPE"].includes(error.code),
          `Unexpected error code ${error.code}`,
        );
        server.close();
      }),
    );
    request.on("response", common.mustNotCall());
    request.write("hello", common.mustSucceed());
  }),
);
