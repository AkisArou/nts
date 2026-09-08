// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { createHostNodeWebPlatform } from "../node-runtime.ts";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
} from "../node-primitives.ts";
import {
  AbortController,
  ReadableStream,
} from "../../../../runtime/web-platform/src/index.ts";
import { Http2Transport } from "../../../../runtime/web-platform/src/http2/transport.ts";
import { HpackEncoder } from "../../../../runtime/web-platform/src/http2/hpack.ts";
import {
  HTTP2_FLAG_END_HEADERS,
  HTTP2_FLAG_END_STREAM,
  HTTP2_FRAME_GOAWAY,
  HTTP2_FRAME_HEADERS,
  HTTP2_FRAME_SETTINGS,
  HTTP2_NO_ERROR,
  decodeHttp2Frame,
  encodeHttp2Frame,
  encodeHttp2GoAway,
} from "../../../../runtime/web-platform/src/http2/frame.ts";
// Symbol-keyed internals: not on the interface prototype and not on the public barrel,
// so a test reaches them the same way the runtime does.
import {
  abortSignalSubscribe,
} from "../../../../runtime/web-platform/src/core/abort-brand.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};

async function consume(stream) {
  if (stream === null) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(Buffer.from(result.value));
      length += result.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function transportRequest(url, overrides = {}) {
  return {
    url,
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function h2Server(t, handler) {
  const server = http2.createServer();
  const sessions = new Set();
  server.on("session", (session) => {
    sessions.add(session);
    session.on("error", () => {});
    session.on("close", () => sessions.delete(session));
  });
  server.on("sessionError", () => {});
  server.on("stream", handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    for (const session of sessions) session.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

suite(
  "HTTP/2 Fetch transport multiplexes one origin and preserves request and response fields",
  async (t) => {
    const seen = [];
    const port = await h2Server(t, (stream, headers) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        seen.push({ headers, body: Buffer.concat(chunks).toString() });
        stream.respond({
          ":status": 200,
          "x-path": headers[":path"],
          "set-cookie": ["a=1", "b=2"],
        });
        stream.end(headers[":path"]);
      });
    });
    const primitives = createHostNodePrimitives();
    const hostConnector = new HostNodeSocketConnector();
    let connectCalls = 0;
    const connectAddresses = [];
    const connector = {
      connect(address, signal) {
        connectCalls++;
        connectAddresses.push(address);
        return hostConnector.connect(address, signal);
      },
    };
    const transport = new Http2Transport(connector, primitives.scheduler);
    t.after(() => transport.close());
    const firstURL = primitives.urls.parse(`http://127.0.0.1:${port}/first?x=1`);
    const secondURL = primitives.urls.parse(`http://127.0.0.1:${port}/second`);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.of(116, 101, 115, 116));
        controller.close();
      },
    });
    const firstPromise = transport.dispatch(
      transportRequest(firstURL, { headers: [["x-test", "one"]] }),
    );
    const secondPromise = transport.dispatch(
      transportRequest(secondURL, {
        method: "POST",
        headers: [["x-test", "two"]],
        body,
        bodyLength: 4,
      }),
    );
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    assert.equal(first.statusText, "");
    assert.equal((await consume(first.body)).toString(), "/first?x=1");
    assert.equal((await consume(second.body)).toString(), "/second");
    assert.deepEqual(
      first.headers.filter(([name]) => name === "set-cookie"),
      [
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ],
    );
    assert.equal(transport.stats.connections, 1);
    assert.equal(transport.stats.origins, 1);
    assert.deepEqual(
      seen.map((entry) => [entry.headers[":path"], entry.headers["x-test"], entry.body]).sort(),
      [
        ["/first?x=1", "one", ""],
        ["/second", "two", "test"],
      ],
    );
    assert.equal(connectCalls, 1);
    assert.deepEqual(connectAddresses[0].alpnProtocols, ["h2"]);
  },
);

suite("shared Fetch redirects and decodes content over the HTTP/2 transport", async (t) => {
  const paths = [];
  const compressed = gzipSync("decoded over h2");
  const port = await h2Server(t, (stream, headers) => {
    paths.push(headers[":path"]);
    if (headers[":path"] === "/start") {
      stream.respond({ ":status": 302, location: "/final" });
      stream.end();
      return;
    }
    assert.match(headers["accept-encoding"], /gzip/);
    stream.respond({
      ":status": 200,
      "content-encoding": "gzip",
      "content-length": String(compressed.length),
    });
    stream.end(compressed);
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  const runtime = createHostNodeWebPlatform({ fetchTransport: transport });
  t.after(() => {
    runtime.close();
    transport.close();
  });
  const response = await runtime.fetch(`http://127.0.0.1:${port}/start`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "decoded over h2");
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(response.headers.get("content-length"), String(compressed.length));
  assert.deepEqual(paths, ["/start", "/final"]);
  assert.equal(transport.stats.connections, 1);
});

class ScriptedConnection {
  closed = false;
  incoming = [];
  pending = null;
  started = false;
  encoder = new HpackEncoder();

  constructor(refuse) {
    this.refuse = refuse;
  }

  read(maxBytes) {
    if (this.incoming.length !== 0) return Promise.resolve(this.take(maxBytes));
    if (this.closed) return Promise.resolve(null);
    const result = Promise.withResolvers();
    this.pending = { maxBytes, result };
    return result.promise;
  }

  write(data) {
    if (this.closed) return Promise.reject(new TypeError("closed"));
    if (!this.started) {
      this.started = true;
      queueMicrotask(() =>
        this.feed(
          encodeHttp2Frame({
            type: HTTP2_FRAME_SETTINGS,
            flags: 0,
            streamId: 0,
            payload: new Uint8Array(0),
          }),
        ),
      );
      return Promise.resolve(data.length);
    }
    let frame = null;
    try {
      frame = decodeHttp2Frame(data);
    } catch {
      return Promise.resolve(data.length);
    }
    if (frame.type === HTTP2_FRAME_HEADERS) {
      queueMicrotask(() => {
        if (this.refuse) {
          this.feed(
            encodeHttp2Frame({
              type: HTTP2_FRAME_GOAWAY,
              flags: 0,
              streamId: 0,
              payload: encodeHttp2GoAway(0, HTTP2_NO_ERROR),
            }),
          );
        } else {
          this.feed(
            encodeHttp2Frame({
              type: HTTP2_FRAME_HEADERS,
              flags: HTTP2_FLAG_END_HEADERS | HTTP2_FLAG_END_STREAM,
              streamId: frame.streamId,
              payload: this.encoder.encode([{ name: ":status", value: "204" }]),
            }),
          );
        }
      });
    }
    return Promise.resolve(data.length);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pending?.result.reject(new TypeError("closed"));
    this.pending = null;
  }

  feed(data) {
    if (this.closed) return;
    this.incoming.push(data);
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    pending.result.resolve(this.take(pending.maxBytes));
  }

  take(maxBytes) {
    const first = this.incoming[0];
    if (first.length <= maxBytes) {
      this.incoming.shift();
      return first;
    }
    const result = first.slice(0, maxBytes);
    this.incoming[0] = first.slice(maxBytes);
    return result;
  }
}

suite(
  "HTTP/2 Fetch transport retries a replayable GOAWAY-refused request on a new connection",
  async () => {
    const connections = [new ScriptedConnection(true), new ScriptedConnection(false)];
    let calls = 0;
    const connector = {
      connect() {
        return Promise.resolve(connections[calls++]);
      },
    };
    const primitives = createHostNodePrimitives();
    const transport = new Http2Transport(connector, primitives.scheduler);
    const url = primitives.urls.parse("http://example.test/retry");
    const response = await transport.dispatch(transportRequest(url));
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(calls, 2);
    transport.close();
  },
);

suite(
  "HTTP/2 Fetch transport applies a response-header deadline and exact timeout class",
  async (t) => {
    let peerStream = null;
    const port = await h2Server(t, (stream) => {
      peerStream = stream;
      stream.on("error", () => {});
    });
    const primitives = createHostNodePrimitives();
    const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler, {
      headersTimeoutMs: 30,
    });
    t.after(() => transport.close());
    const url = primitives.urls.parse(`http://127.0.0.1:${port}/timeout`);
    await assert.rejects(
      transport.dispatch(transportRequest(url)),
      (error) => error?.name === "TimeoutError",
    );
    if (peerStream !== null && !peerStream.closed) await once(peerStream, "close");
    assert.equal(peerStream.rstCode, 8);
  },
);

suite("HTTP/2 Fetch transport applies an idle deadline to each response-body read", async (t) => {
  let peerStream = null;
  const port = await h2Server(t, (stream) => {
    peerStream = stream;
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler, {
    bodyReadTimeoutMs: 30,
  });
  t.after(() => transport.close());
  const url = primitives.urls.parse(`http://127.0.0.1:${port}/body-timeout`);
  const response = await transport.dispatch(transportRequest(url));
  await assert.rejects(consume(response.body), (error) => error?.name === "TimeoutError");
  if (peerStream !== null && !peerStream.closed) await once(peerStream, "close");
  assert.equal(peerStream.rstCode, 8);
});

suite("HTTP/2 Fetch transport drains active streams and rejects new work", async (t) => {
  const peer = Promise.withResolvers();
  const port = await h2Server(t, (stream) => {
    stream.on("error", () => {});
    stream.respond({ ":status": 200 });
    stream.write("before ");
    peer.resolve(stream);
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());
  const url = primitives.urls.parse(`http://127.0.0.1:${port}/drain`);
  const response = await transport.dispatch(transportRequest(url));
  const stream = await peer.promise;
  const drained = transport.drain();
  await assert.rejects(transport.dispatch(transportRequest(url)), /closed/);
  assert.equal(transport.stats.streams, 1);
  stream.end("after");
  assert.equal((await consume(response.body)).toString(), "before after");
  await drained;
  assert.deepEqual(transport.stats, {
    connections: 0,
    connecting: 0,
    origins: 0,
    streams: 0,
  });
});

test("HTTP/2 Fetch transport validates declared body length before opening a socket", async () => {
  let calls = 0;
  const connector = {
    connect() {
      calls++;
      return Promise.reject(new Error("must not connect"));
    },
  };
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(connector, primitives.scheduler);
  const url = primitives.urls.parse("https://example.test/");
  await assert.rejects(
    transport.dispatch(
      transportRequest(url, {
        headers: [["content-length", "2"]],
        body: new ReadableStream(),
        bodyLength: 1,
      }),
    ),
    /does not match/,
  );
  assert.equal(calls, 0);
  transport.close();
});

suite("graceful drain waits for provider work from an open it cancelled", async (t) => {
  const primitives = createHostNodePrimitives();
  // A connector whose cancellation settles late: it observes the abort but keeps
  // provider work outstanding for a while afterwards, which is ordinary for a real
  // socket stack and is exactly the case a drain must not walk away from.
  let observedAbort = false;
  let providerWorkOutstanding = true;
  let releaseConnect;
  const connectReleased = new Promise((resolve) => {
    releaseConnect = resolve;
  });
  const connector = {
    connect(_address, signal) {
      signal[abortSignalSubscribe](() => {
        observedAbort = true;
      });
      return connectReleased.then(() => {
        providerWorkOutstanding = false;
        throw new Error("the cancelled connect finally settled");
      });
    },
  };

  const transport = new Http2Transport(connector, primitives.scheduler);
  t.after(() => transport.close());
  const url = primitives.urls.parse("http://drain.example/slow");
  const dispatch = transport.dispatch(transportRequest(url));
  dispatch.catch(() => {});
  // Let the open reach the connector before draining.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    transport.stats.connecting,
    1,
    "an open must be in flight for this test to mean anything",
  );

  let drained = false;
  const drain = transport.drain().then(() => {
    drained = true;
  });
  assert.equal(observedAbort, true, "drain must cancel an in-flight open");

  // Give drain every opportunity to settle early.
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    drained,
    false,
    "drain reported completion while provider work from a cancelled open was outstanding",
  );
  assert.equal(providerWorkOutstanding, true);

  releaseConnect();
  await drain;
  assert.equal(drained, true);
  assert.equal(providerWorkOutstanding, false);
  assert.equal(transport.stats.connecting, 0);
});

suite("early hints arrive over HTTP/2 through the same contract", async (t) => {
  const port = await h2Server(t, (stream) => {
    // `additionalHeaders` is how node's HTTP/2 server sends an interim response.
    stream.additionalHeaders({ ":status": 103, link: "</style.css>; rel=preload" });
    stream.additionalHeaders({ ":status": 103, link: "</app.js>; rel=preload" });
    stream.respond({ ":status": 200, "content-type": "text/plain" });
    stream.end("done");
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());

  const seen = [];
  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/hinted`), {
      onInformational: (interim) => seen.push(interim),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await consume(response.body)).toString(), "done");

  // The same shape the HTTP/1 transport delivers: status plus name/value pairs, in
  // order, before the final response.
  assert.deepEqual(
    seen.map((interim) => interim.status),
    [103, 103],
  );
  assert.equal(
    seen[0].headers.some(([name, value]) => name === "link" && value.includes("style.css")),
    true,
  );
  assert.equal(
    seen[1].headers.some(([name, value]) => name === "link" && value.includes("app.js")),
    true,
  );
  // Pseudo-headers are not part of what a caller is handed.
  for (const interim of seen) {
    assert.equal(
      interim.headers.some(([name]) => name.startsWith(":")),
      false,
      "a pseudo-header is protocol framing, not a hint",
    );
  }
});

suite("an observer that throws does not reset the HTTP/2 stream", async (t) => {
  const port = await h2Server(t, (stream) => {
    stream.additionalHeaders({ ":status": 103, link: "</a.css>; rel=preload" });
    stream.respond({ ":status": 200 });
    stream.end("fine");
  });
  const reported = [];
  const primitives = createHostNodePrimitives();
  const scheduler = {
    enqueue: (task) => primitives.scheduler.enqueue(task),
    delay: (milliseconds, task) => primitives.scheduler.delay(milliseconds, task),
    reportError: (error) => reported.push(error),
  };
  const transport = new Http2Transport(new HostNodeSocketConnector(), scheduler);
  t.after(() => transport.close());

  // The connection resets a stream if its own callback throws, which is right for a
  // provider defect. A caller merely observing must not be able to trigger it.
  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/throws`), {
      onInformational: () => {
        throw new Error("observer failed");
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await consume(response.body)).toString(), "fine");
  assert.equal(reported.length, 1);
  assert.match(String(reported[0]), /observer failed/);
});

suite("a request with no observer is unaffected over HTTP/2", async (t) => {
  const port = await h2Server(t, (stream) => {
    stream.additionalHeaders({ ":status": 103, link: "</a.css>" });
    stream.respond({ ":status": 200 });
    stream.end("past");
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());
  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/plain`)),
  );
  assert.equal(response.status, 200);
  assert.equal((await consume(response.body)).toString(), "past");
});

suite("a chunk of HTTP/2 trailers is delivered after the body", async (t) => {
  const port = await h2Server(t, (stream) => {
    // `waitForTrailers` is what makes node emit `wantTrailers`; without it the stream
    // ends before there is anywhere to put them.
    stream.respond({ ":status": 200, "content-type": "text/plain" }, { waitForTrailers: true });
    stream.on("wantTrailers", () => {
      stream.sendTrailers({ "x-checksum": "abc123", "x-rows": "7" });
    });
    stream.end("payload");
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());

  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/trailered`)),
  );
  assert.notEqual(response.trailers, undefined, "HTTP/2 must expose trailers too");
  assert.equal((await consume(response.body)).toString(), "payload");
  const trailers = await response.trailers;
  assert.deepEqual(
    trailers.filter(([name]) => name.startsWith("x-")),
    [
      ["x-checksum", "abc123"],
      ["x-rows", "7"],
    ],
  );
});

suite("an HTTP/2 response without trailers settles empty", async (t) => {
  const port = await h2Server(t, (stream) => {
    stream.respond({ ":status": 200 });
    stream.end("plain");
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());
  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/plain`)),
  );
  assert.equal((await consume(response.body)).toString(), "plain");
  assert.deepEqual(await response.trailers, [], "no trailers is empty, not pending");
});

suite("cancelling an HTTP/2 body does not leak an unhandled trailer rejection", async (t) => {
  const port = await h2Server(t, (stream) => {
    stream.respond({ ":status": 200, "content-type": "text/plain" });
    // Keeps writing, so a cancel lands mid-body and the stream is reset.
    stream.write("first chunk");
  });
  const primitives = createHostNodePrimitives();
  const transport = new Http2Transport(new HostNodeSocketConnector(), primitives.scheduler);
  t.after(() => transport.close());

  const response = await transport.dispatch(
    transportRequest(primitives.urls.parse(`http://127.0.0.1:${port}/cancelled`)),
  );
  // Nothing here awaits `response.trailers`. Cancelling rejects it, and an unhandled
  // rejection is a test-runner failure -- which is the only way a missing guard on the
  // derived promise becomes visible, since no assertion can see a promise nobody holds.
  await response.body.cancel(new Error("caller lost interest"));
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(true, "reaching here without an unhandled rejection is the assertion");
});
