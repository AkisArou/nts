import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import net from "node:net";
import { once } from "node:events";
import { HostNodeByteConnection } from "../host/node-primitives.ts";
import {
  AbortController,
  ReadableStream,
} from "../src/index.ts";
import { Http2ClientConnection } from "../src/http2/connection.ts";
import { HpackEncoder } from "../src/http2/hpack.ts";
import {
  HTTP2_FLAG_END_HEADERS,
  HTTP2_FLAG_END_STREAM,
  HTTP2_FLAG_PRIORITY,
  HTTP2_FLOW_CONTROL_ERROR,
  HTTP2_COMPRESSION_ERROR,
  HTTP2_FRAME_DATA,
  HTTP2_FRAME_CONTINUATION,
  HTTP2_FRAME_GOAWAY,
  HTTP2_FRAME_HEADERS,
  HTTP2_FRAME_PING,
  HTTP2_FRAME_RST_STREAM,
  HTTP2_FRAME_SETTINGS,
  HTTP2_INTERNAL_ERROR,
  HTTP2_NO_ERROR,
  HTTP2_PROTOCOL_ERROR,
  HTTP2_REFUSED_STREAM,
  HTTP2_SETTING_MAX_CONCURRENT_STREAMS,
  decodeHttp2Frame,
  encodeHttp2Frame,
  encodeHttp2GoAway,
  encodeHttp2Settings,
  parseHttp2RstStream,
} from "../src/http2/frame.ts";
import { must, portOf } from "./harness.ts";
import type { HpackHeaderField } from "../src/http2/hpack.ts";
import type { Http2Setting } from "../src/http2/frame.ts";
import { Http2WireError } from "../src/http2/frame.ts";
import type { Http2ResponseHeaders } from "../src/http2/headers.ts";
import type { ByteConnection } from "../src/provider/primitives.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function requestHeaders(port: number, path = "/", method = "GET"): HpackHeaderField[] {
  return [
    { name: ":method", value: method },
    { name: ":scheme", value: "http" },
    { name: ":authority", value: `127.0.0.1:${port}` },
    { name: ":path", value: path },
  ];
}

async function consume(stream: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  const reader = must(stream, "the response carries a body").getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      length += result.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    length,
  );
}

async function h2Pair(
  t: TestContext,
  handler: (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => void,
  settings: http2.Settings = {},
  clientOptions: Record<string, unknown> = {},
) {
  const server = http2.createServer({ settings });
  const sessions = new Set<http2.ServerHttp2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.on("error", () => {});
    session.on("close", () => sessions.delete(session));
  });
  server.on("sessionError", () => {});
  server.on("stream", handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = portOf(server);
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await once(socket, "connect");
  const connection = new Http2ClientConnection(new HostNodeByteConnection(socket), clientOptions);
  await connection.start();
  await connection.ready;
  t.after(async () => {
    connection.close();
    await connection.closed;
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { connection, port, sessions };
}

/**
 * The error every wire-level failure here is, narrowed.
 *
 * The predicates read `errorCode` and `streamId`; a thrown value is `unknown`, so each goes
 * through this rather than off a type that does not declare them -- and the class is now
 * checked, where anything carrying an `errorCode` previously satisfied them.
 */
function wireError(error: unknown): Http2WireError {
  assert.ok(error instanceof Http2WireError, "expected an Http2WireError");
  return error;
}

/** A read that arrived before any bytes did, and the size it asked for. */
interface PendingRead {
  readonly maxBytes: number;
  readonly result: PromiseWithResolvers<Uint8Array | null>;
}

class MemoryConnection implements ByteConnection {
  closed = false;
  readonly incoming: Uint8Array[] = [];
  readonly outgoing: Uint8Array[] = [];
  pending: PendingRead | null = null;

  read(maxBytes: number): Promise<Uint8Array | null> {
    if (this.incoming.length !== 0) return Promise.resolve(this.take(maxBytes));
    if (this.closed) return Promise.resolve(null);
    const result = Promise.withResolvers<Uint8Array | null>();
    this.pending = { maxBytes, result };
    return result.promise;
  }

  write(data: Uint8Array): Promise<number> {
    if (this.closed) return Promise.reject(new TypeError("closed"));
    this.outgoing.push(data.slice());
    return Promise.resolve(data.length);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending?.result.reject(new TypeError("closed"));
    this.pending = null;
  }

  feed(data: Uint8Array): void {
    if (this.closed) throw new TypeError("closed");
    this.incoming.push(data.slice());
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    pending.result.resolve(this.take(pending.maxBytes));
  }

  take(maxBytes: number): Uint8Array {
    // Only called when `incoming` is non-empty; the callers check first.
    const first = must(this.incoming[0], "the connection has a buffered chunk");
    if (first.length <= maxBytes) {
      this.incoming.shift();
      return first;
    }
    const result = first.slice(0, maxBytes);
    this.incoming[0] = first.slice(maxBytes);
    return result;
  }
}

async function memoryPair(
  settings: readonly Http2Setting[] = [],
  options: Record<string, unknown> = {},
) {
  const bytes = new MemoryConnection();
  const connection = new Http2ClientConnection(bytes, options);
  await connection.start();
  bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_SETTINGS,
      flags: 0,
      streamId: 0,
      payload: encodeHttp2Settings(settings),
    }),
  );
  await connection.ready;
  return { bytes, connection };
}

suite(
  "real h2c multiplexes responses and preserves informational headers and trailers",
  async (t) => {
    const seen: string[] = [];
    const pair = await h2Pair(t, (stream, headers) => {
      const path = must(headers[":path"], "an HTTP/2 request carries :path");
      seen.push(path);
      if (path === "/slow") {
        setTimeout(() => {
          stream.respond({ ":status": 200, "set-cookie": ["a=1", "b=2"] });
          stream.end("slow");
        }, 20);
        return;
      }
      stream.additionalHeaders({ ":status": 103, link: "</style.css>; rel=preload" });
      stream.respond({ ":status": 200, "content-type": "text/plain" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ checksum: "complete" }));
      stream.end("fast");
    });
    const signal = new AbortController().signal;
    const informational: Http2ResponseHeaders[] = [];
    const slowPromise = pair.connection.request({
      headers: requestHeaders(pair.port, "/slow"),
      body: null,
      signal,
    });
    const fastPromise = pair.connection.request({
      headers: requestHeaders(pair.port, "/fast"),
      body: null,
      signal,
      onInformational: (headers) => informational.push(headers),
    });
    const [slow, fast] = await Promise.all([slowPromise, fastPromise]);
    assert.equal((await consume(fast.body)).toString(), "fast");
    assert.equal((await consume(slow.body)).toString(), "slow");
    assert.deepEqual(
      slow.headers.filter((field) => field.name === "set-cookie").map((field) => field.value),
      ["a=1", "b=2"],
    );
    assert.equal(informational.length, 1);
    assert.equal(must(informational[0], "one informational response arrived").status, 103);
    assert.deepEqual(await fast.trailers, [
      { name: "checksum", value: "complete", neverIndexed: false },
    ]);
    assert.deepEqual(seen.sort(), ["/fast", "/slow"]);
  },
);

suite("response flow control advances only as the body is consumed", async (t) => {
  const payload = Buffer.alloc(256 * 1024, 0x5a);
  let writeFinished = false;
  const pair = await h2Pair(
    t,
    (stream) => {
      stream.respond({ ":status": 200, "content-length": String(payload.length) });
      stream.end(payload, () => {
        writeFinished = true;
      });
    },
    {},
    { initialStreamWindowSize: 31, connectionWindowSize: 65535 },
  );
  const response = await pair.connection.request({
    headers: requestHeaders(pair.port, "/large"),
    body: null,
    signal: new AbortController().signal,
  });
  await tick();
  assert.equal(writeFinished, false);
  const body = await consume(response.body);
  assert.equal(body.length, payload.length);
  assert.equal(body.equals(payload), true);
  await tick();
  assert.equal(writeFinished, true);
});

suite("stream flow-control failure does not terminate an unrelated stream", async () => {
  const pair = await memoryPair([], { initialStreamWindowSize: 3 });
  const signal = new AbortController().signal;
  const failedPromise = pair.connection.request({
    headers: requestHeaders(80, "/too-large"),
    body: null,
    signal,
  });
  const survivorPromise = pair.connection.request({
    headers: requestHeaders(80, "/survivor"),
    body: null,
    signal,
  });
  await tick();

  const encoder = new HpackEncoder();
  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_HEADERS,
      flags: HTTP2_FLAG_END_HEADERS,
      streamId: 1,
      payload: encoder.encode([{ name: ":status", value: "200" }]),
    }),
  );
  const failed = await failedPromise;
  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_DATA,
      flags: HTTP2_FLAG_END_STREAM,
      streamId: 1,
      payload: Uint8Array.of(1, 2, 3, 4),
    }),
  );
  await assert.rejects(
    consume(failed.body),
    (error: unknown) => wireError(error).errorCode === HTTP2_FLOW_CONTROL_ERROR && wireError(error).streamId === 1,
  );

  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_HEADERS,
      flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
      streamId: 3,
      payload: encoder.encode([{ name: ":status", value: "204" }]),
    }),
  );
  const survivor = await survivorPromise;
  assert.equal(survivor.status, 204);
  assert.equal((await consume(survivor.body)).length, 0);
  pair.connection.close();
  await pair.connection.closed;
});

suite("HPACK compression failure terminates the connection with COMPRESSION_ERROR", async () => {
  const pair = await memoryPair();
  const request = pair.connection.request({
    headers: requestHeaders(80, "/invalid-hpack"),
    body: null,
    signal: new AbortController().signal,
  });
  await tick();
  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_HEADERS,
      flags: HTTP2_FLAG_END_HEADERS,
      streamId: 1,
      payload: Uint8Array.of(0x80),
    }),
  );
  await assert.rejects(request, (error: unknown) => wireError(error).errorCode === HTTP2_COMPRESSION_ERROR);
  await pair.connection.closed;
  const goAway = decodeHttp2Frame(must(pair.bytes.outgoing.at(-1), "a GOAWAY frame was written"));
  assert.equal(goAway.type, HTTP2_FRAME_GOAWAY);
  assert.equal(goAway.payload[7], HTTP2_COMPRESSION_ERROR);
});

suite(
  "aborting a bounded concurrency waiter removes it without consuming the next slot",
  async () => {
    const pair = await memoryPair(
      [{ identifier: HTTP2_SETTING_MAX_CONCURRENT_STREAMS, value: 1 }],
      { maximumPendingRequests: 1 },
    );
    const signal = new AbortController().signal;
    const firstPromise = pair.connection.request({
      headers: requestHeaders(80, "/first"),
      body: null,
      signal,
    });
    await tick();
    const cancelled = new AbortController();
    const reason = { marker: "queued cancellation" };
    const secondPromise = pair.connection.request({
      headers: requestHeaders(80, "/cancelled"),
      body: null,
      signal: cancelled.signal,
    });
    await tick();
    await assert.rejects(
      pair.connection.request({
        headers: requestHeaders(80, "/overflow"),
        body: null,
        signal,
      }),
      /pending request queue is full/,
    );
    cancelled.abort(reason);
    await assert.rejects(secondPromise, (error: unknown) => error === reason);

    const encoder = new HpackEncoder();
    pair.bytes.feed(
      encodeHttp2Frame({
        type: HTTP2_FRAME_HEADERS,
        flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
        streamId: 1,
        payload: encoder.encode([{ name: ":status", value: "204" }]),
      }),
    );
    const first = await firstPromise;
    await consume(first.body);
    const thirdPromise = pair.connection.request({
      headers: requestHeaders(80, "/third"),
      body: null,
      signal,
    });
    await tick();
    assert.equal(pair.connection.activeStreamCount, 1);
    pair.bytes.feed(
      encodeHttp2Frame({
        type: HTTP2_FRAME_HEADERS,
        flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
        streamId: 3,
        payload: encoder.encode([{ name: ":status", value: "204" }]),
      }),
    );
    const third = await thirdPromise;
    await consume(third.body);
    pair.connection.close();
    await pair.connection.closed;
  },
);

suite("request Content-Length is enforced against the bytes produced by the body", async () => {
  const pair = await memoryPair();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(1));
      controller.close();
    },
  });
  const request = pair.connection.request({
    headers: [...requestHeaders(80, "/short", "POST"), { name: "content-length", value: "2" }],
    body,
    signal: new AbortController().signal,
  });
  await assert.rejects(
    request,
    (error: unknown) => wireError(error).errorCode === HTTP2_INTERNAL_ERROR && wireError(error).streamId === 1,
  );
  pair.connection.close();
  await pair.connection.closed;
});

suite("request upload obeys the peer stream window and reaches END_STREAM", async (t) => {
  const payload = Uint8Array.from({ length: 128 * 1024 }, (_, index) => index & 255);
  const pair = await h2Pair(
    t,
    (stream) => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        length += chunk.length;
      });
      stream.on("end", () => {
        const received = Buffer.concat(chunks, length);
        assert.equal(received.equals(Buffer.from(payload)), true);
        stream.respond({ ":status": 200 });
        stream.end(String(length));
      });
    },
    { initialWindowSize: 17 },
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  const response = await pair.connection.request({
    headers: [
      ...requestHeaders(pair.port, "/upload", "POST"),
      { name: "content-length", value: String(payload.length) },
    ],
    body,
    signal: new AbortController().signal,
  });
  assert.equal((await consume(response.body)).toString(), String(payload.length));
});

suite("peer maximum-concurrency queues later streams until an active stream closes", async (t) => {
  const arrivals: string[] = [];
  // Resolved from inside the server handler, so it says what it is before assignment.
  let releaseFirst: () => void = () => {};
  const firstCanEnd = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const pair = await h2Pair(
    t,
    async (stream, headers) => {
      arrivals.push(must(headers[":path"], "an HTTP/2 request carries :path"));
      stream.respond({ ":status": 200 });
      if (headers[":path"] === "/first") await firstCanEnd;
      stream.end(headers[":path"]);
    },
    { maxConcurrentStreams: 1 },
  );
  const signal = new AbortController().signal;
  const first = await pair.connection.request({
    headers: requestHeaders(pair.port, "/first"),
    body: null,
    signal,
  });
  const secondPromise = pair.connection.request({
    headers: requestHeaders(pair.port, "/second"),
    body: null,
    signal,
  });
  await tick();
  assert.deepEqual(arrivals, ["/first"]);
  releaseFirst();
  assert.equal((await consume(first.body)).toString(), "/first");
  const second = await secondPromise;
  assert.equal((await consume(second.body)).toString(), "/second");
  assert.deepEqual(arrivals, ["/first", "/second"]);
});

suite("abort rejects with exact identity and sends CANCEL to the peer", async (t) => {
  let serverStream: http2.ServerHttp2Stream | undefined;
  // Resolved from inside the server handler, so it says what it is before it is assigned.
  let streamArrived: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    streamArrived = resolve;
  });
  const pair = await h2Pair(t, (stream) => {
    serverStream = stream;
    stream.on("error", () => {});
    streamArrived();
  });
  const controller = new AbortController();
  const reason = { marker: "exact abort reason" };
  const request = pair.connection.request({
    headers: requestHeaders(pair.port, "/cancel"),
    body: null,
    signal: controller.signal,
  });
  await arrived;
  controller.abort(reason);
  await assert.rejects(request, (error: unknown) => error === reason);
  const cancelled = must(serverStream, "the server saw the stream before it was aborted");
  if (!cancelled.closed) await once(cancelled, "close");
  assert.equal(cancelled.rstCode, 8);
});

suite("PING is acknowledged with the exact opaque payload", async (t) => {
  const pair = await h2Pair(t, (stream) => {
    stream.respond({ ":status": 204 });
    stream.end();
  });
  const session = must([...pair.sessions][0], "the server accepted a session");
  const opaque = Buffer.from("0102030405060708", "hex");
  const reply = await new Promise<Buffer>((resolve, reject) => {
    session.ping(opaque, (error: Error | null, _duration: number, payload: Buffer) => {
      if (error) reject(error);
      else resolve(payload);
    });
  });
  assert.deepEqual(reply, opaque);
});

suite("GOAWAY retries streams above lastStreamId while an accepted stream completes", async () => {
  const pair = await memoryPair();
  const signal = new AbortController().signal;
  const firstPromise = pair.connection.request({
    headers: requestHeaders(80, "/first"),
    body: null,
    signal,
  });
  const secondPromise = pair.connection.request({
    headers: requestHeaders(80, "/second"),
    body: null,
    signal,
  });
  await tick();
  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_GOAWAY,
      flags: 0,
      streamId: 0,
      payload: encodeHttp2GoAway(1, HTTP2_NO_ERROR),
    }),
  );
  await assert.rejects(secondPromise, (error: unknown) => wireError(error).errorCode === HTTP2_REFUSED_STREAM);

  const block = new HpackEncoder().encode([{ name: ":status", value: "200" }]);
  pair.bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_HEADERS,
      flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
      streamId: 1,
      payload: block,
    }),
  );
  const first = await firstPromise;
  assert.equal((await consume(first.body)).length, 0);
  await pair.connection.closed;
});

suite("a non-SETTINGS first peer frame produces a protocol GOAWAY", async () => {
  const bytes = new MemoryConnection();
  const connection = new Http2ClientConnection(bytes);
  await connection.start();
  bytes.feed(
    encodeHttp2Frame({
      type: HTTP2_FRAME_PING,
      flags: 0,
      streamId: 0,
      payload: Uint8Array.from({ length: 8 }, (_, index) => index),
    }),
  );
  await assert.rejects(connection.ready, (error: unknown) => wireError(error).errorCode === HTTP2_PROTOCOL_ERROR);
  await connection.closed;
  const last = must(bytes.outgoing.at(-1), "a GOAWAY frame was written");
  const goAway = decodeHttp2Frame(last);
  assert.equal(goAway.type, HTTP2_FRAME_GOAWAY);
  assert.equal(goAway.payload[7], HTTP2_PROTOCOL_ERROR);
});

suite(
  "a fragmented self-dependent HEADERS block resets only its stream and preserves HPACK",
  async () => {
    const pair = await memoryPair();
    const signal = new AbortController().signal;
    const firstPromise = pair.connection.request({
      headers: requestHeaders(80, "/malformed"),
      body: null,
      signal,
    });
    const secondPromise = pair.connection.request({
      headers: requestHeaders(80, "/survivor"),
      body: null,
      signal,
    });
    await tick();
    assert.equal(pair.connection.activeStreamCount, 2);

    const encoder = new HpackEncoder();
    const malformedBlock = encoder.encode([
      { name: ":status", value: "200" },
      { name: "x-dynamic-state", value: "preserved" },
    ]);
    const malformedHeaders = encodeHttp2Frame({
      type: HTTP2_FRAME_HEADERS,
      flags: HTTP2_FLAG_PRIORITY,
      streamId: 1,
      payload: Uint8Array.from([0, 0, 0, 0, 15, malformedBlock[0]]),
    });
    malformedHeaders[12] = 1;
    pair.bytes.feed(malformedHeaders);
    pair.bytes.feed(
      encodeHttp2Frame({
        type: HTTP2_FRAME_CONTINUATION,
        flags: HTTP2_FLAG_END_HEADERS,
        streamId: 1,
        payload: malformedBlock.slice(1),
      }),
    );
    await assert.rejects(
      firstPromise,
      (error: unknown) => wireError(error).errorCode === HTTP2_PROTOCOL_ERROR && wireError(error).streamId === 1,
    );
    await tick();
    const reset = pair.bytes.outgoing
      .map((chunk) => {
        try {
          return decodeHttp2Frame(chunk);
        } catch {
          return null;
        }
      })
      .find((frame) => frame?.type === HTTP2_FRAME_RST_STREAM && frame.streamId === 1);
    assert.equal(
      parseHttp2RstStream(must(reset, "the peer sent an RST_STREAM for stream 1")),
      HTTP2_PROTOCOL_ERROR,
    );

    const survivorBlock = encoder.encode([
      { name: ":status", value: "200" },
      { name: "x-dynamic-state", value: "preserved" },
    ]);
    pair.bytes.feed(
      encodeHttp2Frame({
        type: HTTP2_FRAME_HEADERS,
        flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
        streamId: 3,
        payload: survivorBlock,
      }),
    );
    const survivor = await secondPromise;
    assert.deepEqual(survivor.headers, [
      { name: "x-dynamic-state", value: "preserved", neverIndexed: false },
    ]);
    assert.equal((await consume(survivor.body)).length, 0);
    pair.connection.close();
    await pair.connection.closed;
  },
);
