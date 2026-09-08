// HTTP/1 trailers reach the caller.
//
// They were parsed, checked for forbidden framing names, and discarded. Every consumer
// of `TransportResponse.trailers` -- diagnostics, deduplication, the response
// collector, the snapshot recorder -- handled a field no real transport ever produced,
// so only the mock exercised them. This is the producing half.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createServer } from "node:net";

import {
  AbortController,
  DiagnosticsInterceptor,
} from "../../../../runtime/web-platform/src/index.ts";
import { Http1Transport } from "../../../../runtime/web-platform/src/http1/transport.ts";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../node-primitives.ts";
import { portOf } from "./harness.ts";
import type { Socket } from "node:net";
import { must } from "./harness.ts";
import type { TransportRequest } from "../../../../runtime/web-platform/src/fetch/transport.ts";
import type { DispatchDiagnosticEvent } from "../../../../runtime/web-platform/src/dispatch/diagnostics.ts";
import type { ReadableStream } from "../../../../runtime/web-platform/src/streams/readable.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const CRLF = String.fromCharCode(13, 10);

async function rawServer(t: TestContext, responseText: string): Promise<number> {
  const sockets = new Set<Socket>();
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
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return portOf(server);
}

function transportRequest(url: string, overrides: Partial<TransportRequest> = {}): TransportRequest {
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

async function consume(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
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

function makeTransport(t: TestContext): Http1Transport {
  const primitives = createHostNodePrimitives();
  const transport = new Http1Transport(new HostNodeSocketConnector(), primitives.scheduler, {});
  t.after(() => transport.close());
  return transport;
}

/** A chunked body followed by a trailer section. */
function chunked(body: string, trailerLines: readonly string[]): string {
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
  must(response.trailers, "a chunked response carries trailers").then(
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
  await assert.rejects(must(response.trailers, "a chunked response carries trailers"), /Forbidden framing trailer/);
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
  await assert.rejects(must(response.trailers, "a chunked response carries trailers"));
});

suite("cancelling the body rejects the trailers", async (t) => {
  const port = await rawServer(t, chunked("payload", ["x-checksum: abc"]));
  const transport = makeTransport(t);
  const response = await transport.dispatch(transportRequest(`http://127.0.0.1:${port}/`));
  await must(response.body, "a chunked response carries a body").cancel(new Error("caller lost interest"));
  await assert.rejects(must(response.trailers, "a chunked response carries trailers"));
});

suite("trailer consumers see real trailers, not only fixtures", async (t) => {
  // Until trailers were produced, every consumer of `TransportResponse.trailers` was
  // exercised only against `MockAgent`. This runs the diagnostics interceptor over a
  // real transport and a real server, which is the claim that change was worth making.
  const port = await rawServer(
    t,
    chunked("payload", ["x-checksum: abc123", "authorization: Bearer secret"]),
  );
  const events: DispatchDiagnosticEvent[] = [];
  const interceptor = new DiagnosticsInterceptor({
    observer: { publish: (event) => events.push(event) },
    scheduler: {
      enqueue() {},
      delay() {
        return { cancel() {} };
      },
      reportError() {},
    },
  });
  const transport = makeTransport(t);
  const response = await interceptor.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`),
    transport,
  );
  assert.equal(await consume(response.body), "payload");
  // The observation settles after the body, so give it its turn.
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));

  const trailerEvents = events.filter(
    (event): event is Extract<DispatchDiagnosticEvent, { type: "response:trailers" }> =>
      event.type === "response:trailers",
  );
  assert.equal(trailerEvents.length, 1, "a real response must publish its trailers once");
  const trailerEvent = trailerEvents[0];
  assert.ok(trailerEvent !== undefined, "the trailer event was published");
  assert.deepEqual(
    trailerEvent.headers.find(([name]) => name === "x-checksum"),
    ["x-checksum", "abc123"],
  );
  // Redaction applies to trailers exactly as it does to headers. A credential does not
  // become publishable by arriving after the body.
  const authorization = trailerEvent.headers.find(([name]) => name === "authorization");
  assert.ok(authorization !== undefined, "the field is reported");
  assert.notEqual(authorization[1], "Bearer secret", "but never its value");
});
