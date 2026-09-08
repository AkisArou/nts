// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// Interim (1xx) responses were counted and discarded, so `103 Early Hints` -- the one
// interim response a client is meant to act on -- could never be seen. These tests use
// a raw socket server, because Node's HTTP server will not emit a malformed or
// unusual interim sequence on request.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createServer } from "node:net";

import { AbortController } from "../../../../runtime/web-platform/src/index.ts";
import { Http1Transport } from "../../../../runtime/web-platform/src/http1/transport.ts";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../node-primitives.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const CRLF = String.fromCharCode(13, 10);

/** A server that writes exactly the response text it is given. */
async function rawServer(t, responseText) {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let head = "";
    socket.on("data", (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes(CRLF + CRLF)) return;
      socket.write(responseText);
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

function transportRequest(url, overrides = {}) {
  return {
    url: hostNodeURLs.parse(url),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function consume(stream) {
  if (stream === null) return "";
  const reader = stream.getReader();
  const parts = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      parts.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString();
}

function makeTransport(t, options = {}) {
  const primitives = createHostNodePrimitives();
  const transport = new Http1Transport(
    new HostNodeSocketConnector(),
    primitives.scheduler,
    options,
  );
  t.after(() => transport.close());
  return transport;
}

suite("early hints reach the caller in order, before the final response", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 103 Early Hints" +
      CRLF +
      "link: </style.css>; rel=preload; as=style" +
      CRLF +
      "link: </app.js>; rel=preload; as=script" +
      CRLF +
      CRLF +
      "HTTP/1.1 103 Early Hints" +
      CRLF +
      "link: </late.png>; rel=preload" +
      CRLF +
      CRLF +
      "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 4" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "done",
  );
  const transport = makeTransport(t);
  const seen = [];
  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, {
      onInformational: (interim) => seen.push(interim),
    }),
  );

  // Both hints arrived, in order, before the final response was returned.
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((interim) => interim.status),
    [103, 103],
  );
  assert.deepEqual(seen[0].headers, [
    ["link", "</style.css>; rel=preload; as=style"],
    ["link", "</app.js>; rel=preload; as=script"],
  ]);
  assert.deepEqual(seen[1].headers, [["link", "</late.png>; rel=preload"]]);

  // And the final response is unaffected by having been preceded by them.
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "done");
});

suite("the final response is never delivered as an interim one", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 2" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "ok",
  );
  const transport = makeTransport(t);
  const seen = [];
  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, {
      onInformational: (interim) => seen.push(interim),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "ok");
  assert.deepEqual(seen, [], "a 200 is not a hint");
});

suite("a 100 Continue is an interim response like any other", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 100 Continue" +
      CRLF +
      CRLF +
      "HTTP/1.1 204 No Content" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF,
  );
  const transport = makeTransport(t);
  const seen = [];
  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, {
      onInformational: (interim) => seen.push(interim),
    }),
  );
  assert.equal(response.status, 204);
  assert.deepEqual(
    seen.map((interim) => interim.status),
    [100],
  );
});

suite("a caller that throws does not change the request", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 103 Early Hints" +
      CRLF +
      "link: </a.css>; rel=preload" +
      CRLF +
      CRLF +
      "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 5" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "fine!",
  );
  const reported = [];
  const primitives = createHostNodePrimitives();
  // Delegating explicitly rather than spreading: the host scheduler's methods live on
  // its prototype, and a spread copies none of them.
  const scheduler = {
    enqueue: (task) => primitives.scheduler.enqueue(task),
    delay: (milliseconds, task) => primitives.scheduler.delay(milliseconds, task),
    reportError: (error) => reported.push(error),
  };
  const transport = new Http1Transport(new HostNodeSocketConnector(), scheduler, {});
  t.after(() => transport.close());

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, {
      onInformational: () => {
        throw new Error("observer failed");
      },
    }),
  );
  // Observing a request is not permission to fail it.
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "fine!");
  assert.equal(reported.length, 1);
  assert.match(String(reported[0]), /observer failed/);
});

suite("the caller may mutate what it is given", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 103 Early Hints" +
      CRLF +
      "link: </a.css>" +
      CRLF +
      CRLF +
      "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 2" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "hi",
  );
  const transport = makeTransport(t);
  const captured = [];
  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, {
      onInformational: (interim) => {
        captured.push(interim);
        interim.headers.push(["injected", "value"]);
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "hi");
  assert.equal(captured[0].headers.length, 2, "the mutation landed on what was handed over");
  assert.equal(
    response.headers.some(([name]) => name === "injected"),
    false,
  );
  // Deliberately not claimed: that the copy is what protects the transport. Handing
  // over the live array passes this test too, because an interim head is discarded the
  // moment it has been published and there is nothing left to contaminate. The copy is
  // defensive and no test here can show it; saying so beats implying otherwise.
});

suite("the interim limit still applies and is still a LimitError", async (t) => {
  let text = "";
  for (let index = 0; index < 6; index++) {
    text += "HTTP/1.1 103 Early Hints" + CRLF + "link: </" + index + ".css>" + CRLF + CRLF;
  }
  text +=
    "HTTP/1.1 200 OK" +
    CRLF +
    "content-length: 2" +
    CRLF +
    "connection: close" +
    CRLF +
    CRLF +
    "no";
  const port = await rawServer(t, text);
  const transport = makeTransport(t, { maxInformational: 3 });
  const seen = [];
  await assert.rejects(
    transport.dispatch(
      transportRequest(`http://127.0.0.1:${port}/`, {
        onInformational: (interim) => seen.push(interim),
      }),
    ),
    (error) => /Too many informational/.test(String(error)),
  );
  // Exposing hints did not raise the bound: the ones within it were still delivered.
  assert.equal(seen.length, 3);
});

suite("a request without an observer is unaffected", async (t) => {
  const port = await rawServer(
    t,
    "HTTP/1.1 103 Early Hints" +
      CRLF +
      "link: </a.css>" +
      CRLF +
      CRLF +
      "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 4" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "past",
  );
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "past");
});
