"use strict";

// Supported behavior retained from pinned upstream test-http-agent-remove.js.
// The upstream file additionally inspects socket._httpMessage, a private
// dynamically attached property that is outside NTS's fixed object layout.
const common = require("../common");
const assert = require("assert");
const http = require("http");

const server = http.createServer(
  common.mustCall((_request, response) => {
    response.flushHeaders();
  }),
);

server.listen(
  0,
  common.mustCall(() => {
    const agent = new http.Agent({ keepAlive: true });
    const options = { port: server.address().port, agent };
    const name = agent.getName({ host: "localhost", port: options.port });
    const request = http.get(
      options,
      common.mustCall(() => {
        const socket = request.socket;
        assert(socket);
        assert.strictEqual(agent.sockets[name].length, 1);
        assert.strictEqual(agent.totalSocketCount, 1);

        socket.emit("agentRemove");

        assert.strictEqual(agent.sockets[name], undefined);
        assert.strictEqual(agent.freeSockets[name], undefined);
        assert.strictEqual(agent.totalSocketCount, 0);
        socket.destroy();
        server.close();
      }),
    );
  }),
);
