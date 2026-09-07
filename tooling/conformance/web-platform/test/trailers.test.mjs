// HTTP/1 trailers reach the caller.
//
// They were parsed, checked for forbidden framing names, and discarded. Every consumer
// of `TransportResponse.trailers` -- diagnostics, deduplication, the response
// collector, the snapshot recorder -- handled a field no real transport ever produced,
// so only the mock exercised them. This is the producing half.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";

import { AbortController } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { Http1Transport } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/transport.js";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const CRLF = String.fromCharCode(13, 10);

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
      // Ending the socket matters: a truncated `content-length` body is only truncated
      // once the peer stops sending. Leaving it open makes the reader wait for bytes
      // that are not coming, which reads as "the trailers never settled" and is really
      // "the server never finished".
      socket.end(responseText);
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

function makeTransport(t) {
  const primitives = createHostNodePrimitives();
  const transport = new Http1Transport(new HostNodeSocketConnector(), primitives.scheduler, {});
  t.after(() => transport.close());
  return transport;
}

/** A chunked body followed by a trailer section. */
function chunked(body, trailerLines) {
  let text = "HTTP/1.1 200 OK" + CRLF;
  text += "transfer-encoding: chunked" + CRLF;
  text += "trailer: x-checksum" + CRLF;
  text += "connection: close" + CRLF + CRLF;
  text += body.length.toString(16) + CRLF + body + CRLF;
  text += "0" + CRLF;
  for (const line of trailerLines) text += line + CRLF;
  return text + CRLF;
}

suite("a chunked response delivers its trailer section", async (t) => {
  const port = await rawServer(t, chunked("payload", ["x-checksum: abc123", "x-rows: 7"]));
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  assert.notEqual(response.trailers, undefined, "a real transport must produce trailers");
  assert.equal(await consume(response.body), "payload");
  assert.deepEqual(await response.trailers, [
    ["x-checksum", "abc123"],
    ["x-rows", "7"],
  ]);
});

suite("trailers settle only once the body has ended", async (t) => {
  const port = await rawServer(t, chunked("slow", ["x-checksum: zzz"]));
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));

  let settled = false;
  response.trailers.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  // The body has not been read, so the trailer section has not been reached.
  for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "trailers cannot be known before the body ends");

  assert.equal(await consume(response.body), "slow");
  assert.deepEqual(await response.trailers, [["x-checksum", "zzz"]]);
});

suite("a framing that carries no trailers settles empty rather than hanging", async (t) => {
  // Fixed length.
  const fixedPort = await rawServer(
    t,
    "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 5" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "fixed",
  );
  const transport = makeTransport(t);
  const fixed = await transport.dispatch(transportRequest(`http://127.0.0.1:${fixedPort}/`));
  assert.equal(await consume(fixed.body), "fixed");
  assert.deepEqual(await fixed.trailers, []);

  // A bodyless response.
  const emptyPort = await rawServer(
    t,
    "HTTP/1.1 204 No Content" + CRLF + "connection: close" + CRLF + CRLF,
  );
  const empty = await transport.dispatch(transportRequest(`http://127.0.0.1:${emptyPort}/`));
  assert.equal(empty.body, null);
  assert.deepEqual(await empty.trailers, []);
});

suite("a forbidden framing trailer is still refused", async (t) => {
  // A trailer section may not carry framing fields; that check predates this change
  // and must survive it.
  const port = await rawServer(t, chunked("x", ["transfer-encoding: chunked"]));
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  await assert.rejects(consume(response.body), /Forbidden framing trailer/);
  await assert.rejects(response.trailers, /Forbidden framing trailer/);
});

suite("a truncated body rejects the trailers rather than leaving them pending", async (t) => {
  // Declares eight bytes and sends three, then closes.
  const port = await rawServer(
    t,
    "HTTP/1.1 200 OK" +
      CRLF +
      "content-length: 8" +
      CRLF +
      "connection: close" +
      CRLF +
      CRLF +
      "abc",
  );
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  await assert.rejects(consume(response.body));
  // A caller awaiting trailers learns the body failed instead of waiting forever.
  await assert.rejects(response.trailers);
});

suite("cancelling the body rejects the trailers", async (t) => {
  const port = await rawServer(t, chunked("payload", ["x-checksum: abc"]));
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  await response.body.cancel(new Error("caller lost interest"));
  await assert.rejects(response.trailers);
});
