"use strict";

// Supported behavior retained from pinned upstream
// test-http-agent-free-socket-data-guard.js. The upstream file additionally
// inspects socket.parser, a private dynamically attached implementation field.
const common = require("../common");
const assert = require("assert");
const http = require("http");

let serverSocket;
const server = http.createServer(
  common.mustCall((request, response) => {
    serverSocket ||= request.socket;
    response.end(request.url);
  }, 2),
);

server.listen(
  0,
  common.mustCall(() => {
    const agent = new http.Agent({ keepAlive: true });
    const options = { host: "127.0.0.1", port: server.address().port, agent };
    const name = agent.getName(options);

    const first = http.request({ ...options, path: "/first" });
    first.end();
    first.on(
      "response",
      common.mustCall((response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on(
          "end",
          common.mustCall(() => {
            assert.strictEqual(body, "/first");
          }),
        );
      }),
    );

    first.on(
      "close",
      common.mustCall(() => {
        process.nextTick(
          common.mustCall(() => {
            const freeSocket = agent.freeSockets[name]?.[0];
            assert(freeSocket);
            assert.strictEqual(freeSocket.listenerCount("data"), 0);
            assert.strictEqual(freeSocket.listenerCount("readable"), 0);

            serverSocket.write(
              "HTTP/1.1 200 OK\r\n" +
                "X-Poisoned: true\r\n" +
                "Connection: keep-alive\r\n" +
                "Content-Length: 0\r\n" +
                "\r\n",
            );

            setTimeout(
              common.mustCall(() => {
                assert.strictEqual(freeSocket.destroyed, true);
                assert.strictEqual(agent.freeSockets[name], undefined);

                const second = http.request({ ...options, path: "/second" });
                second.end();
                second.on(
                  "response",
                  common.mustCall((response) => {
                    let body = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk) => {
                      body += chunk;
                    });
                    response.on(
                      "end",
                      common.mustCall(() => {
                        assert.strictEqual(response.headers["x-poisoned"], undefined);
                        assert.strictEqual(body, "/second");
                        agent.destroy();
                        server.close();
                      }),
                    );
                  }),
                );
              }),
              50,
            );
          }),
        );
      }),
    );
  }),
);
