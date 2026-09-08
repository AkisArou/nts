// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// Adapted from the verified external delivery after removing its synthetic realm API.
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import https from "node:https";
import { createHash } from "node:crypto";
import {
  brotliCompressSync,
  constants as zlibConstants,
  createDeflateRaw,
  createInflateRaw,
  deflateRawSync,
  deflateSync,
  gzipSync,
  inflateRawSync,
} from "node:zlib";
import { once } from "node:events";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  ReadableStream,
  AbortController,
  EventSource,
  fetch as webFetch,
  Request,
  TextEncoder,
  Response,
  WebSocket,
  WebSocketError,
  WebSocketStream,
} from "../src/index.ts";
import { ConnectionPool } from "../src/http1/pool.ts";
import { decodeContentCodings } from "../src/fetch/content-coding.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { tlsFixture } from "./tls-fixture.ts";
// Symbol-keyed internals: not on the interface prototype and not on the public barrel,
// so a test reaches them the same way the runtime does.
import {
  abortSignalSubscribe,
} from "../src/core/abort-brand.ts";
// Symbol-keyed stream internals: off the interface prototype and off the public barrel,
// so a test reaches them the same way the runtime does.
import { kStreamDisturbed } from "../src/streams/readable.ts";

globalThis.fetch = () => {
  throw new Error("Host fetch is forbidden");
};
globalThis.WebSocket = class {
  constructor() {
    throw new Error("Host WebSocket is forbidden");
  }
};
const encoder = new TextEncoder();
const tick = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
async function server(t, handler, raw = false, secure = false) {
  const listener = raw
    ? net.createServer(handler)
    : secure
      ? https.createServer(tlsFixture(), handler)
      : http.createServer(handler);
  const sockets = new Set();
  listener.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => listener.close(resolve));
  });
  return {
    listener,
    url: `${secure ? "https" : "http"}://127.0.0.1:${listener.address().port}`,
    sockets,
  };
}
function runtime(t, options = {}, sockets = {}) {
  const api = createHostNodeWebPlatform(options, sockets);
  t.after(() => api.close());
  return api;
}
async function bodyOf(request) {
  const chunks = [];
  for await (const part of request) chunks.push(part);
  return Buffer.concat(chunks).toString();
}
function errorChain(error) {
  return String(error) + (error?.cause ? " " + errorChain(error.cause) : "");
}

suite("HTTP POST, duplicate Set-Cookie, real response identity and connection reuse", async (t) => {
  let requests = 0;
  const s = await server(t, async (req, res) => {
    requests++;
    const body = await bodyOf(req);
    res.setHeader("Set-Cookie", ["a=1", "b=2"]);
    res.end(req.method + ":" + body);
  });
  const api = runtime(t);
  const request = new Request(s.url, { method: "POST", body: "Καλημέρα" });
  const response = await webFetch(request);
  assert.ok(response instanceof Response);
  assert.deepEqual(response.headers.getSetCookie(), ["a=1", "b=2"]);
  assert.equal(await response.text(), "POST:Καλημέρα");
  assert.equal(await (await api.fetch(s.url)).text(), "GET:");
  assert.equal(requests, 2);
  assert.equal(s.sockets.size, 1);
  assert.deepEqual(api.http1.pool.stats, { connections: 1, pending: 0, idle: 1 });
  assert.throws(() => response.headers.set("x", "y"));
});
suite("Incremental chunked upload and response with trailers", async (t) => {
  const s = await server(t, async (req, res) => {
    assert.equal(req.headers["transfer-encoding"], "chunked");
    const text = await bodyOf(req);
    res.writeHead(200, { Trailer: "X-Checksum" });
    res.write(text.slice(0, 2));
    await tick();
    res.write(text.slice(2));
    res.addTrailers({ "X-Checksum": "ok" });
    res.end();
  });
  const api = runtime(t);
  let index = 0;
  const body = new ReadableStream(
    {
      pull(c) {
        if (index === 3) c.close();
        else c.enqueue(encoder.encode(String(index++)));
      },
    },
    { highWaterMark: 0 },
  );
  const r = await api.fetch(s.url, { method: "POST", body, duplex: "half" });
  assert.equal(await r.text(), "012");
  assert.equal(body[kStreamDisturbed], true);
  assert.equal(api.http1.pool.stats.idle, 1);
});
for (const status of [301, 302, 303, 307, 308])
  suite("Redirect " + status + " method/body semantics", async (t) => {
    const s = await server(t, async (req, res) => {
      const text = await bodyOf(req);
      if (req.url === "/start") {
        res.writeHead(status, { location: "/done" });
        res.end("redirect-body");
      } else res.end(req.method + ":" + text + ":" + (req.headers["content-type"] ?? ""));
    });
    const api = runtime(t);
    const r = await api.fetch(s.url + "/start", { method: "POST", body: "original" });
    const expected =
      status === 307 || status === 308 ? "POST:original:text/plain;charset=UTF-8" : "GET::";
    assert.equal(await r.text(), expected);
    assert.equal(r.redirected, true);
    assert.equal(r.url, s.url + "/done");
  });
suite("Cross-origin redirect removes sensitive credentials", async (t) => {
  const destination = await server(t, (req, res) => res.end(JSON.stringify(req.headers)));
  const origin = await server(t, (req, res) => {
    req.resume();
    res.writeHead(302, { location: destination.url });
    res.end();
  });
  const api = runtime(t);
  const value = await (
    await api.fetch(origin.url, {
      headers: [
        ["Authorization", "Bearer private"],
        ["Cookie", "secret=1"],
        ["X-Public", "ok"],
      ],
    })
  ).json();
  assert.equal(value.authorization, undefined);
  assert.equal(value.cookie, undefined);
  assert.equal(value["x-public"], "ok");
});
suite("Manual and error redirect modes, looping redirects, nonreplayable 307", async (t) => {
  const s = await server(t, (req, res) => {
    req.resume();
    res.writeHead(req.url === "/stream" ? 307 : 302, { location: "/again" });
    res.end("redirect");
  });
  const api = runtime(t);
  const manual = await api.fetch(s.url, { redirect: "manual" });
  assert.equal(manual.status, 302);
  assert.equal(await manual.text(), "redirect");
  await assert.rejects(api.fetch(s.url, { redirect: "error" }));
  await assert.rejects(api.fetch(s.url), (e) => /Too many redirects/.test(errorChain(e)));
  const body = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode("stream"));
      c.close();
    },
  });
  await assert.rejects(
    api.fetch(s.url + "/stream", { method: "POST", body, duplex: "half" }),
    (e) => /replay/.test(errorChain(e)),
  );
});
suite("Abort before dispatch preserves reason identity", async (t) => {
  const api = runtime(t);
  const c = new AbortController();
  const reason = { abort: 1 };
  c.abort(reason);
  await assert.rejects(
    api.fetch("http://127.0.0.1:8080", { signal: c.signal }),
    (e) => e === reason,
  );
});
suite("Abort during headers and after response delivery cancels sockets and body", async (t) => {
  let requested;
  const arrived = new Promise((r) => (requested = r));
  const s = await server(t, (req, res) => {
    req.resume();
    if (req.url === "/headers") requested();
    else {
      res.writeHead(200);
      res.write("hello");
    }
  });
  const api = runtime(t);
  const c = new AbortController();
  const pending = api.fetch(s.url + "/headers", { signal: c.signal });
  await arrived;
  c.abort("headers");
  await assert.rejects(pending, (e) => e === "headers");
  const after = new AbortController();
  const response = await api.fetch(s.url + "/body", { signal: after.signal });
  after.abort("body");
  await assert.rejects(response.text(), (e) => e === "body");
  await tick();
  assert.equal(api.http1.pool.stats.idle, 0);
});
suite("Pending read abort and response cancellation settle without draining", async (t) => {
  const s = await server(t, (_req, res) => {
    res.writeHead(200, { "content-length": "99" });
    res.flushHeaders();
  });
  const api = runtime(t);
  const c = new AbortController();
  const r = await api.fetch(s.url, { signal: c.signal });
  const reader = r.body.getReader();
  const pending = reader.read();
  c.abort("stop");
  await assert.rejects(pending, (e) => e === "stop");
  const other = await api.fetch(s.url);
  await other.body.cancel();
  assert.equal(api.http1.pool.stats.connections, 0);
});
suite("Early response interrupts an upload awaiting a producer", async (t) => {
  const s = await server(t, (_req, res) => {
    res.writeHead(413, { connection: "close" });
    res.end("too large");
  });
  const api = runtime(t);
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const r = await api.fetch(s.url, { method: "POST", body, duplex: "half" });
  assert.equal(r.status, 413);
  assert.equal(await r.text(), "too large");
  await tick();
  assert.equal(cancelled, true);
  assert.equal(api.http1.pool.stats.connections, 0);
});
suite("HEAD and null-body status handling", async (t) => {
  const s = await server(t, (req, res) => {
    res.writeHead(req.url === "/empty" ? 204 : 200, { "content-length": "100" });
    res.end();
  });
  const api = runtime(t);
  const r = await api.fetch(s.url, { method: "HEAD" });
  assert.equal(r.body, null);
  assert.equal(await r.text(), "");
  const noContent = await api.fetch(s.url + "/empty");
  assert.equal(noContent.status, 204);
  assert.equal(noContent.body, null);
});
for (const [coding, compress] of [
  ["gzip", gzipSync],
  ["deflate", deflateSync],
  ["br", brotliCompressSync],
])
  suite("Native compression primitive: " + coding, async (t) => {
    const bytes = compress(Buffer.from("streamed content ".repeat(1000)));
    const s = await server(t, (_req, res) => {
      res.writeHead(200, { "content-encoding": coding, "content-length": bytes.length });
      res.end(bytes);
    });
    const api = runtime(t);
    const r = await api.fetch(s.url);
    assert.equal(await r.text(), "streamed content ".repeat(1000));
    assert.equal(r.headers.get("content-encoding"), coding);
  });
suite("Advertised content codings match the provider and preserve caller policy", async (t) => {
  const observed = [];
  const s = await server(t, (req, res) => {
    observed.push(req.headers["accept-encoding"]);
    res.end("ok");
  });
  const api = runtime(t);
  await (await api.fetch(s.url)).text();
  await (await api.fetch(s.url, { headers: { "accept-encoding": "identity" } })).text();
  const identityOnly = runtime(t, {
    contentDecoder: {
      codings: [],
      supports: () => false,
      decode: () => {
        throw new Error("An unadvertised decoder must not run");
      },
    },
  });
  await (await identityOnly.fetch(s.url)).text();
  assert.deepEqual(observed, ["br, gzip, deflate", "identity", "identity"]);

  assert.throws(
    () =>
      runtime(t, {
        contentDecoder: {
          codings: ["gzip"],
          supports: () => false,
          decode: (_coding, source) => source,
        },
      }),
    /advertises an unsupported coding/i,
  );
  assert.throws(
    () =>
      runtime(t, {
        contentDecoder: {
          codings: ["gzip, deflate"],
          supports: () => true,
          decode: (_coding, source) => source,
        },
      }),
    /invalid advertised content coding/i,
  );
});
suite("HTTP deflate accepts zlib-wrapped and interoperable raw streams", async (t) => {
  const expected = "raw deflate ".repeat(1000);
  const zlib = deflateSync(Buffer.from(expected));
  const raw = deflateRawSync(Buffer.from(expected));
  const s = await server(t, async (req, res) => {
    res.writeHead(200, { "content-encoding": "deflate" });
    if (req.url === "/raw") {
      res.write(raw.subarray(0, 1));
      await tick();
      res.end(raw.subarray(1));
    } else res.end(zlib);
  });
  const api = runtime(t);
  assert.equal(await (await api.fetch(s.url + "/zlib")).text(), expected);
  assert.equal(await (await api.fetch(s.url + "/raw")).text(), expected);
});
suite("Content decoders reject corrupt checksums and coded payloads", async (t) => {
  const corruptGzip = gzipSync(Buffer.from("checksum"));
  corruptGzip[corruptGzip.length - 1] ^= 1;
  const corruptDeflate = deflateSync(Buffer.from("adler"));
  corruptDeflate[corruptDeflate.length - 1] ^= 1;
  const brotli = brotliCompressSync(Buffer.from("brotli"));
  const corruptBrotli = brotli.subarray(0, brotli.length - 1);
  const s = await server(t, (req, res) => {
    const [coding, bytes] =
      req.url === "/gzip"
        ? ["gzip", corruptGzip]
        : req.url === "/deflate"
          ? ["deflate", corruptDeflate]
          : ["br", corruptBrotli];
    res.writeHead(200, { "content-encoding": coding });
    res.end(bytes);
  });
  const api = runtime(t);
  for (const coding of ["gzip", "deflate", "br"]) {
    await assert.rejects((await api.fetch(s.url + "/" + coding)).arrayBuffer());
  }
});
suite("Reversed coding stack, decompression errors, consumption byte cap", async (t) => {
  const encoded = gzipSync(brotliCompressSync(Buffer.from("stacked")));
  const s = await server(t, (req, res) => {
    if (req.url === "/bad") {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end("broken");
    } else {
      res.writeHead(200, { "content-encoding": "br, gzip" });
      res.end(encoded);
    }
  });
  const api = runtime(t);
  assert.equal(await (await api.fetch(s.url)).text(), "stacked");
  await assert.rejects((await api.fetch(s.url + "/bad")).text());
  const bounded = runtime(t, { bodyPolicy: { maxConsumeBytes: 3 } });
  await assert.rejects((await bounded.fetch(s.url)).text(), /limit/);
});
suite("Content-coding policy bounds decoded bytes and wire expansion", async (t) => {
  const text = "compression bomb ".repeat(131072);
  const encoded = gzipSync(Buffer.from(text));
  const s = await server(t, (_req, res) => {
    res.writeHead(200, { "content-encoding": "gzip", "content-length": encoded.length });
    res.end(encoded);
  });

  const defaults = runtime(t);
  await assert.rejects((await defaults.fetch(s.url)).text(), /expansion ratio/i);

  const byteBounded = runtime(t, {
    contentCodingPolicy: {
      maxDecodedBytes: 1024,
      maxExpansionRatio: Infinity,
      ratioGraceBytes: 0,
    },
  });
  await assert.rejects((await byteBounded.fetch(s.url)).text(), /decoded.*byte limit/i);

  const ratioBounded = runtime(t, {
    contentCodingPolicy: {
      maxDecodedBytes: Infinity,
      maxExpansionRatio: 2,
      ratioGraceBytes: 1024,
    },
  });
  await assert.rejects((await ratioBounded.fetch(s.url)).text(), /expansion ratio/i);

  const relaxed = runtime(t, {
    contentCodingPolicy: {
      maxDecodedBytes: text.length,
      maxExpansionRatio: Infinity,
      ratioGraceBytes: 0,
    },
  });
  assert.equal(await (await relaxed.fetch(s.url)).text(), text);
});
suite("Content-coding limit cancels the decoder stack with the same failure", async () => {
  let cancellation;
  const wire = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1));
    },
    cancel(reason) {
      cancellation = reason;
    },
  });
  const expandingDecoder = {
    supports() {
      return true;
    },
    decode(_coding, source) {
      const input = source.getReader();
      let emitted = false;
      return new ReadableStream({
        async pull(controller) {
          if (emitted) return;
          emitted = true;
          await input.read();
          controller.enqueue(new Uint8Array(2048));
        },
        cancel(reason) {
          return input.cancel(reason);
        },
      });
    },
  };
  const guarded = decodeContentCodings(wire, ["test"], expandingDecoder, {
    maxDecodedBytes: Infinity,
    maxExpansionRatio: 1,
    ratioGraceBytes: 0,
  });
  const error = await new Response(guarded).arrayBuffer().then(
    () => null,
    (reason) => reason,
  );
  assert.match(String(error), /expansion ratio/i);
  assert.equal(cancellation, error);
});
suite("Content-coding policy rejects invalid limits at runtime construction", (t) => {
  for (const contentCodingPolicy of [
    { maxDecodedBytes: -1 },
    { maxDecodedBytes: 0.5 },
    { maxExpansionRatio: 0.5 },
    { maxExpansionRatio: Number.NaN },
    { ratioGraceBytes: -1 },
  ]) {
    assert.throws(() => runtime(t, { contentCodingPolicy }), RangeError);
  }
});
for (const [name, wire, headError] of [
  [
    "TE+CL",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\n0\r\n\r\n",
    true,
  ],
  [
    "different Content-Length",
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\nx",
    true,
  ],
  [
    "non-HTTP whitespace around Content-Length",
    Buffer.from("HTTP/1.1 200 OK\r\nContent-Length:\xa02\r\n\r\nx", "latin1"),
    true,
  ],
  [
    "non-HTTP whitespace around Transfer-Encoding",
    Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding:\xa0chunked\r\n\r\n0\r\n\r\n", "latin1"),
    true,
  ],
  ["folded header", "HTTP/1.1 200 OK\r\nX-Test: a\r\n b\r\n\r\n", true],
  ["truncated fixed body", "HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nx", false],
  ["bad chunk size", "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nX\r\n", false],
  [
    "bad chunk extension",
    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;name="unterminated\r\nx\r\n0\r\n\r\n',
    false,
  ],
  [
    "missing chunk terminator",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\naXX0\r\n\r\n",
    false,
  ],
  [
    "framing trailer",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nContent-Length: 1\r\n\r\n",
    false,
  ],
])
  suite("Reject malformed HTTP: " + name, async (t) => {
    const s = await server(t, (socket) => socket.once("data", () => socket.end(wire)), true);
    const api = runtime(t);
    if (headError) await assert.rejects(api.fetch(s.url));
    else await assert.rejects((await api.fetch(s.url)).text());
    assert.equal(api.http1.pool.stats.idle, 0);
  });
suite(
  "Partial header reads, informational responses, chunk extensions and wire order",
  async (t) => {
    const wire =
      'HTTP/1.1 103 Early Hints\r\nLink: </x>\r\n\r\nHTTP/1.1 200 Yep\r\nTransfer-Encoding: chunked\r\nSet-Cookie: a\r\nX-B: 2\r\nSet-Cookie: b\r\n\r\n3 \t; x \t= \t"quoted\\\"value" ; flag\r\nabc\r\n0;done\r\n\r\n';
    const s = await server(
      t,
      (socket) =>
        socket.once("data", () => {
          (async () => {
            for (const char of wire) {
              if (socket.destroyed) return;
              socket.write(char);
              await tick();
            }
          })().catch(() => {});
        }),
      true,
    );
    const api = runtime(t);
    const r = await api.fetch(s.url);
    assert.equal(r.statusText, "Yep");
    assert.deepEqual(r.headers.getSetCookie(), ["a", "b"]);
    assert.equal(await r.text(), "abc");
  },
);
suite("Content-Length mismatch and header injection rejected before connecting", async (t) => {
  const api = runtime(t);
  await assert.rejects(
    api.fetch("http://127.0.0.1:54321", {
      method: "POST",
      body: "x",
      headers: [["content-length", "2"]],
    }),
  );
  await assert.rejects(api.fetch("http://127.0.0.1:54321", { headers: [["x", "a\r\nb"]] }));
  assert.equal(api.http1.pool.stats.connections, 0);
});
suite("HTTP timeouts, queued acquisition cancellation and pool shutdown", async (t) => {
  const s = await server(t, (_req, res) => {
    res.writeHead(200, { "content-length": "5" });
    res.flushHeaders();
  });
  const api = runtime(t, {
    http1: { maxConnections: 1, maxConnectionsPerOrigin: 1, bodyReadTimeoutMs: 30 },
  });
  const r = await api.fetch(s.url);
  const c = new AbortController();
  const pending = api.fetch(s.url, { signal: c.signal });
  await tick();
  c.abort("queued");
  await assert.rejects(pending, (e) => e === "queued");
  await assert.rejects(r.text(), (e) => /timed out/.test(errorChain(e)));
  assert.equal(api.http1.pool.stats.connections, 0);
  const never = await server(t, () => {}, true);
  const headers = runtime(t, { http1: { headersTimeoutMs: 30 } });
  await assert.rejects(headers.fetch(never.url));
});
suite("ConnectionPool.close interrupts an outstanding connector", async () => {
  let entered;
  const ready = new Promise((resolve) => (entered = resolve));
  let aborted = false;
  const pool = new ConnectionPool(
    {
      connect(_address, signal) {
        entered();
        return new Promise((_r, reject) =>
          signal[abortSignalSubscribe](() => {
            aborted = true;
            reject(signal.reason);
          }),
        );
      },
    },
    createHostNodePrimitives().scheduler,
  );
  const pending = pool.acquire(
    { hostname: "test", port: 80, secure: false, connectTimeoutMs: 1000 },
    new AbortController().signal,
  );
  await ready;
  pool.close();
  await assert.rejects(pending);
  await tick();
  assert.equal(aborted, true);
  assert.equal(pool.stats.connections, 0);
});

suite("ConnectionPool removes canceled waiters without disturbing FIFO order", async () => {
  class ReusableConnection {
    closed = false;

    read() {
      return Promise.resolve(null);
    }

    write(data) {
      return Promise.resolve(data.length);
    }

    close() {
      this.closed = true;
    }
  }

  const connection = new ReusableConnection();
  const pool = new ConnectionPool(
    { connect: () => Promise.resolve(connection) },
    createHostNodePrimitives().scheduler,
    { maxConnections: 1, maxConnectionsPerOrigin: 1, maxPending: 2050 },
  );
  const address = { hostname: "queue.test", port: 80, secure: false, connectTimeoutMs: 1000 };
  const first = await pool.acquire(address, new AbortController().signal);
  const delivered = [];
  const canceled = [];
  const controllers = [];
  const pending = [];

  for (let index = 0; index < 2050; index++) {
    const controller = new AbortController();
    controllers.push(controller);
    pending.push(
      pool.acquire(address, controller.signal).then(
        (lease) => {
          delivered.push(index);
          lease.release(true);
        },
        (reason) => {
          assert.equal(reason, index);
          canceled.push(index);
        },
      ),
    );
  }
  await assert.rejects(
    pool.acquire(address, new AbortController().signal),
    /Connection pool queue is full/,
  );

  const expectedDelivered = [];
  const expectedCanceled = [];
  for (let index = 0; index < controllers.length; index++) {
    if (index % 3 === 1) {
      expectedCanceled.push(index);
      controllers[index].abort(index);
    } else expectedDelivered.push(index);
  }
  assert.equal(pool.stats.pending, expectedDelivered.length);

  first.release(true);
  await Promise.all(pending);
  assert.deepEqual(canceled, expectedCanceled);
  assert.deepEqual(delivered, expectedDelivered);
  assert.deepEqual(pool.stats, { connections: 1, pending: 0, idle: 1 });
  pool.close();
  assert.equal(connection.closed, true);
});

suite("ConnectionPool skips a waiter blocked by its origin cap", async () => {
  const connections = [];
  const connectedOrigins = [];
  const pool = new ConnectionPool(
    {
      connect(address) {
        connectedOrigins.push(address.hostname);
        const connection = {
          closed: false,
          read: () => Promise.resolve(null),
          write: (data) => Promise.resolve(data.length),
          close() {
            this.closed = true;
          },
        };
        connections.push(connection);
        return Promise.resolve(connection);
      },
    },
    createHostNodePrimitives().scheduler,
    { maxConnections: 2, maxConnectionsPerOrigin: 1 },
  );
  const signal = new AbortController().signal;
  const originA = { hostname: "a.test", port: 80, secure: false, connectTimeoutMs: 1000 };
  const originB = { hostname: "b.test", port: 80, secure: false, connectTimeoutMs: 1000 };
  const firstA = await pool.acquire(originA, signal);
  let secondASettled = false;
  const secondA = pool.acquire(originA, signal).then((lease) => {
    secondASettled = true;
    return lease;
  });
  const firstB = await pool.acquire(originB, signal);

  assert.deepEqual(connectedOrigins, ["a.test", "b.test"]);
  assert.equal(secondASettled, false);
  assert.deepEqual(pool.stats, { connections: 2, pending: 1, idle: 0 });

  firstB.release(false);
  await tick();
  assert.equal(secondASettled, false);
  firstA.release(false);
  const acquiredA = await secondA;
  assert.deepEqual(connectedOrigins, ["a.test", "b.test", "a.test"]);
  acquiredA.release(false);
  pool.close();
  assert.equal(
    connections.every((connection) => connection.closed),
    true,
  );
});

// Independent test-server frame encoder/parser. These do not call the implementation's codec.
function frame(opcode, payload = Buffer.alloc(0), fin = true, compressed = false) {
  const bytes = Buffer.from(payload);
  const head = Buffer.alloc(bytes.length < 126 ? 2 : bytes.length <= 65535 ? 4 : 10);
  head[0] = (fin ? 128 : 0) | (compressed ? 64 : 0) | opcode;
  if (head.length === 2) head[1] = bytes.length;
  else if (head.length === 4) {
    head[1] = 126;
    head.writeUInt16BE(bytes.length, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(bytes.length), 2);
  }
  return Buffer.concat([head, bytes]);
}
function peerParser(socket, onFrame) {
  let data = Buffer.alloc(0);
  socket.on("data", (part) => {
    data = Buffer.concat([data, part]);
    while (data.length >= 2) {
      const first = data[0],
        mask = data[1] & 128;
      assert.equal(mask, 128, "Client frames must be masked");
      let length = data[1] & 127,
        offset = 2;
      if (length === 126) {
        if (data.length < 4) return;
        length = data.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (data.length < 10) return;
        length = Number(data.readBigUInt64BE(2));
        offset = 10;
      }
      if (data.length < offset + 4 + length) return;
      const key = data.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(data.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4];
      data = data.subarray(offset + length);
      onFrame({ opcode: first & 15, fin: !!(first & 128), compressed: !!(first & 64), payload });
    }
  });
}

function zlibMessage(transform, input) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const accept = (chunk) => chunks.push(Buffer.from(chunk));
    const fail = (error) => {
      transform.off("data", accept);
      transform.off("error", fail);
      reject(error);
    };
    transform.on("data", accept);
    transform.once("error", fail);
    transform.write(input, (writeError) => {
      if (writeError) {
        fail(writeError);
        return;
      }
      transform.flush(zlibConstants.Z_SYNC_FLUSH, () => {
        transform.off("data", accept);
        transform.off("error", fail);
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

function stripDeflateTail(bytes) {
  assert.deepEqual(bytes.subarray(bytes.length - 4), Buffer.from([0, 0, 255, 255]));
  return bytes.subarray(0, bytes.length - 4);
}

function deflateMessage(bytes, windowBits = 15) {
  return stripDeflateTail(
    deflateRawSync(bytes, {
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
      flush: zlibConstants.Z_SYNC_FLUSH,
      windowBits,
    }),
  );
}

function inflateMessage(bytes, windowBits = 15) {
  return inflateRawSync(Buffer.concat([bytes, Buffer.from([0, 0, 255, 255])]), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
    windowBits,
  });
}
async function websocketServer(t, onOpen, { badAccept = false, extra = "", secure = false } = {}) {
  const s = await server(
    t,
    (_req, res) => {
      res.writeHead(426);
      res.end();
    },
    false,
    secure,
  );
  s.listener.on("upgrade", (req, socket, head) => {
    assert.equal(head.length, 0);
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        (badAccept ? "bad" : accept) +
        "\r\n" +
        extra +
        "\r\n",
    );
    onOpen(socket, req);
  });
  return { ...s, url: s.url.replace("http", "ws") };
}
function wsEvents(ws) {
  const log = [];
  const opened = new Promise((resolve) =>
    ws.addEventListener("open", () => {
      log.push("open");
      resolve();
    }),
  );
  const closed = new Promise((resolve) =>
    ws.addEventListener("close", (event) => {
      log.push("close");
      resolve(event);
    }),
  );
  ws.addEventListener("error", () => log.push("error"));
  return { opened, closed, log };
}

class ControlledWebSocketSession {
  protocol = "chat";
  extensions = "";
  nextCalls = 0;
  sent = [];
  closes = [];
  aborted = false;
  incoming = [];
  reads = [];
  sendWait = null;

  next() {
    this.nextCalls++;
    const queued = this.incoming.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    const result = Promise.withResolvers();
    this.reads.push(result);
    return result.promise;
  }

  push(value) {
    if (value.kind === "close") this.sendWait?.reject(new Error("peer closed during send"));
    const read = this.reads.shift();
    if (read === undefined) this.incoming.push(value);
    else read.resolve(value);
  }

  send(message) {
    this.sent.push(message);
    return this.sendWait?.promise ?? Promise.resolve();
  }

  close(code, reason) {
    this.closes.push({ code, reason });
    return Promise.resolve();
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.push({ kind: "close", code: 1006, reason: "", wasClean: false, failed: true });
  }
}

function controlledWebSocketRuntime(t, session = new ControlledWebSocketSession()) {
  let connects = 0;
  const api = runtime(t, {
    webSocketTransport: {
      connect() {
        connects++;
        return Promise.resolve(session);
      },
    },
  });
  return {
    api,
    session,
    get connects() {
      return connects;
    },
  };
}

suite("WebSocketError applies close dictionary conversion and validation", (t) => {
  runtime(t);
  assert.throws(() => new WebSocketStream(), TypeError);
  assert.throws(
    () => new WebSocketStream("invalid:"),
    (error) => error.name === "SyntaxError",
  );
  assert.throws(() => new WebSocketStream("ws://example.test", true), TypeError);
  assert.throws(() => new WebSocketStream("ws://example.test", { protocols: "chat" }), TypeError);

  const empty = new WebSocketError();
  assert.equal(empty.name, "WebSocketError");
  assert.equal(empty.message, "");
  assert.equal(empty.code, 0);
  assert.equal(empty.closeCode, null);
  assert.equal(empty.reason, "");

  const converted = new WebSocketError("message", { closeCode: 2999.5, reason: "\ud800" });
  assert.equal(converted.closeCode, 3000);
  assert.equal(converted.reason, "\ufffd");
  assert.equal(new WebSocketError("", { reason: "why" }).closeCode, 1000);
  for (const closeCode of [999, 1001, 2999, 5000]) {
    assert.throws(
      () => new WebSocketError("", { closeCode }),
      (error) => error.name === "InvalidAccessError",
    );
  }
  assert.throws(
    () => new WebSocketError("", { reason: "🔌".repeat(32) }),
    (error) => error.name === "SyntaxError",
  );
});

suite("WebSocket forbidden ports fail asynchronously", async (t) => {
  const controlled = controlledWebSocketRuntime(t);
  const stream = new WebSocketStream("ws://example.test:22/socket");
  const streamError = await stream.opened.then(
    () => assert.fail("a forbidden port must not open"),
    (reason) => reason,
  );
  assert.ok(streamError instanceof WebSocketError);
  await assert.rejects(stream.closed, (reason) => reason === streamError);

  const socket = new WebSocket("ws://example.test:22/socket");
  const events = wsEvents(socket);
  const close = await events.closed;
  assert.equal(close.code, 1006);
  assert.equal(close.reason, "");
  assert.equal(close.wasClean, false);
  assert.deepEqual(events.log, ["error", "close"]);
  assert.equal(controlled.connects, 0, "a blocked port must not reach the transport");
});

suite("WebSocketStream is pull-driven and writer close waits for the peer", async (t) => {
  const controlled = controlledWebSocketRuntime(t);
  const stream = new WebSocketStream("ws://example.test/socket", { protocols: ["chat"] });
  const { readable, writable, protocol, extensions } = await stream.opened;
  assert.equal(stream.url, "ws://example.test/socket");
  assert.equal(protocol, "chat");
  assert.equal(extensions, "");

  await tick();
  assert.equal(controlled.session.nextCalls, 1, "one chunk may be prefetched");
  controlled.session.push({ kind: "text", data: "first" });
  await tick();
  assert.equal(controlled.session.nextCalls, 1, "a full readable queue must stop transport reads");

  const reader = readable.getReader();
  assert.deepEqual(await reader.read(), { done: false, value: "first" });
  await tick();
  assert.equal(
    controlled.session.nextCalls,
    2,
    "consumption must request exactly one more message",
  );
  controlled.session.push({ kind: "binary", data: Uint8Array.of(1, 2, 3) });
  const binary = await reader.read();
  assert.equal(binary.done, false);
  assert.ok(binary.value instanceof Uint8Array);
  assert.deepEqual(binary.value, Uint8Array.of(1, 2, 3));

  const writer = writable.getWriter();
  controlled.session.sendWait = Promise.withResolvers();
  const bytes = Uint8Array.of(4, 5, 6);
  const write = writer.write(bytes.subarray(1));
  await tick();
  bytes.fill(9);
  assert.deepEqual(controlled.session.sent, [{ kind: "binary", data: Uint8Array.of(5, 6) }]);
  let writeSettled = false;
  write.finally(() => {
    writeSettled = true;
  });
  await tick();
  assert.equal(writeSettled, false, "write resolves only when the provider accepts the bytes");
  controlled.session.sendWait.resolve();
  await write;

  const closing = writer.close();
  await tick();
  assert.deepEqual(controlled.session.closes, [{ code: null, reason: "" }]);
  let closingSettled = false;
  closing.finally(() => {
    closingSettled = true;
  });
  await tick();
  assert.equal(closingSettled, false, "writer close must await the peer close frame");
  controlled.session.push({
    kind: "close",
    code: 1005,
    reason: "",
    wasClean: true,
    failed: false,
  });
  await closing;
  assert.deepEqual(await stream.closed, { closeCode: 1005, reason: "" });
});

suite("WebSocketStream close, cancel, and remote-close semantics", async (t) => {
  const publicClose = controlledWebSocketRuntime(t);
  const publicStream = new WebSocketStream("ws://example.test/public-close");
  await publicStream.opened;
  assert.throws(() => publicStream.close(true), TypeError);
  publicStream.close({ reason: "because" });
  assert.deepEqual(publicClose.session.closes, [{ code: 1000, reason: "because" }]);
  publicClose.session.push({
    kind: "close",
    code: 1000,
    reason: "because",
    wasClean: true,
    failed: false,
  });
  assert.deepEqual(await publicStream.closed, { closeCode: 1000, reason: "because" });

  const canceled = controlledWebSocketRuntime(t);
  const canceledStream = new WebSocketStream("ws://example.test/cancel");
  const canceledInfo = await canceledStream.opened;
  const cancellation = canceledInfo.readable.cancel({ closeCode: 3333, reason: "ignored" });
  await tick();
  assert.deepEqual(canceled.session.closes, [{ code: null, reason: "" }]);
  canceled.session.push({
    kind: "close",
    code: 1005,
    reason: "",
    wasClean: true,
    failed: false,
  });
  await cancellation;
  assert.deepEqual(await canceledStream.closed, { closeCode: 1005, reason: "" });

  const withError = controlledWebSocketRuntime(t);
  const errorStream = new WebSocketStream("ws://example.test/cancel-with-error");
  const errorInfo = await errorStream.opened;
  const errorCancellation = errorInfo.readable.cancel(
    new WebSocketError("", { closeCode: 3456, reason: "set" }),
  );
  await tick();
  assert.deepEqual(withError.session.closes, [{ code: 3456, reason: "set" }]);
  withError.session.push({
    kind: "close",
    code: 3456,
    reason: "set",
    wasClean: true,
    failed: false,
  });
  await errorCancellation;
  assert.deepEqual(await errorStream.closed, { closeCode: 3456, reason: "set" });

  const remote = controlledWebSocketRuntime(t);
  const remoteStream = new WebSocketStream("ws://example.test/remote");
  const remoteInfo = await remoteStream.opened;
  remote.session.push({
    kind: "close",
    code: 4000,
    reason: "remote",
    wasClean: true,
    failed: false,
  });
  assert.deepEqual(await remoteStream.closed, { closeCode: 4000, reason: "remote" });
  assert.deepEqual(await remoteInfo.readable.getReader().read(), { done: true, value: undefined });
  await assert.rejects(
    remoteInfo.writable.getWriter().ready,
    (error) => error.name === "InvalidStateError",
  );

  const unwritten = controlledWebSocketRuntime(t);
  const unwrittenStream = new WebSocketStream("ws://example.test/unwritten");
  const unwrittenInfo = await unwrittenStream.opened;
  unwritten.session.sendWait = Promise.withResolvers();
  const writer = unwrittenInfo.writable.getWriter();
  const write = writer.write(new Uint8Array(1024));
  await tick();
  unwritten.session.push({
    kind: "close",
    code: 4567,
    reason: "stop",
    wasClean: true,
    failed: false,
  });
  const closedError = await unwrittenStream.closed.then(
    () => assert.fail("unwritten data must make closure unclean"),
    (reason) => reason,
  );
  assert.ok(closedError instanceof WebSocketError);
  assert.equal(closedError.closeCode, 4567);
  const writeError = await write.then(
    () => assert.fail("pending write must reject"),
    (reason) => reason,
  );
  assert.equal(writeError.name, "InvalidStateError");
  await assert.rejects(writer.write("later"), (reason) => reason === writeError);
});

suite("WebSocketStream failure identity, handshake abort, and runtime ownership", async (t) => {
  const failed = controlledWebSocketRuntime(t);
  const abrupt = new WebSocketStream("ws://example.test/abrupt");
  const { readable, writable } = await abrupt.opened;
  const reader = readable.getReader();
  const writer = writable.getWriter();
  failed.session.push({
    kind: "close",
    code: 1006,
    reason: "",
    wasClean: false,
    failed: true,
  });
  const error = await abrupt.closed.then(
    () => assert.fail("abrupt close must reject"),
    (reason) => reason,
  );
  assert.ok(error instanceof WebSocketError);
  assert.equal(error.closeCode, 1006);
  await assert.rejects(reader.read(), (reason) => reason === error);
  await assert.rejects(writer.ready, (reason) => reason === error);

  const before = new AbortController();
  before.abort();
  const never = controlledWebSocketRuntime(t);
  const preAborted = new WebSocketStream("ws://example.test/never", { signal: before.signal });
  await assert.rejects(preAborted.opened, (reason) => reason === before.signal.reason);
  await assert.rejects(preAborted.closed, (reason) => reason === before.signal.reason);
  assert.equal(never.connects, 0, "a pre-aborted stream must not invoke the transport");

  const duringAbort = new AbortController();
  const connection = Promise.withResolvers();
  runtime(t, {
    webSocketTransport: {
      connect(_handshake, signal) {
        signal[abortSignalSubscribe](() => connection.reject(signal.reason));
        return connection.promise;
      },
    },
  });
  const connecting = new WebSocketStream("ws://example.test/connect", {
    signal: duringAbort.signal,
  });
  duringAbort.abort();
  await assert.rejects(connecting.opened, (reason) => reason === duringAbort.signal.reason);
  await assert.rejects(connecting.closed, (reason) => reason === duringAbort.signal.reason);

  const afterAbort = new AbortController();
  const after = controlledWebSocketRuntime(t);
  const connected = new WebSocketStream("ws://example.test/connected", {
    signal: afterAbort.signal,
  });
  const connectedInfo = await connected.opened;
  afterAbort.abort();
  await connectedInfo.writable.getWriter().write("still connected");
  assert.deepEqual(after.session.sent, [{ kind: "text", data: "still connected" }]);
  assert.equal(after.session.aborted, false);
  connected.close();
  after.session.push({
    kind: "close",
    code: 1005,
    reason: "",
    wasClean: true,
    failed: false,
  });
  await connected.closed;

  const owned = controlledWebSocketRuntime(t);
  const live = new WebSocketStream("ws://example.test/live");
  await live.opened;
  owned.api.close();
  await assert.rejects(live.closed, WebSocketError);
  assert.equal(owned.session.aborted, true);
});

suite("Canonical WebSocket constructor uses the installed environment", async (t) => {
  const controlled = controlledWebSocketRuntime(t);
  const socket = new WebSocket("ws://example.test/socket", "chat");
  const events = wsEvents(socket);
  await events.opened;
  assert.equal(controlled.connects, 1);
  assert.equal(socket.protocol, "chat");
  socket.close(1000, "done");
  await tick();
  controlled.session.push({
    kind: "close",
    code: 1000,
    reason: "done",
    wasClean: true,
    failed: false,
  });
  assert.equal((await events.closed).code, 1000);
});

suite("WebSocketStream exchanges text and binary over the real transport", async (t) => {
  const s = await websocketServer(
    t,
    (socket) =>
      peerParser(socket, (incoming) => {
        if (incoming.opcode === 8) socket.end(frame(8, incoming.payload));
        else socket.write(frame(incoming.opcode, incoming.payload, incoming.fin));
      }),
    { extra: "Sec-WebSocket-Protocol: chat\r\n" },
  );
  runtime(t);
  const stream = new WebSocketStream(s.url, { protocols: ["chat"] });
  const { readable, writable, protocol } = await stream.opened;
  assert.equal(protocol, "chat");
  const reader = readable.getReader();
  const writer = writable.getWriter();

  await writer.write("hello 💙");
  assert.deepEqual(await reader.read(), { done: false, value: "hello 💙" });
  await writer.write(Uint8Array.of(1, 2, 3));
  const binary = await reader.read();
  assert.equal(binary.done, false);
  assert.ok(binary.value instanceof Uint8Array);
  assert.deepEqual(binary.value, Uint8Array.of(1, 2, 3));

  const closing = writer.close();
  assert.deepEqual(await stream.closed, { closeCode: 1005, reason: "" });
  await closing;
});

suite("WebSocket accepts a server that declines every offered subprotocol", async (t) => {
  const s = await websocketServer(t, (socket) =>
    peerParser(socket, (incoming) => {
      if (incoming.opcode === 8) socket.end(frame(8, incoming.payload));
    }),
  );
  runtime(t);
  const stream = new WebSocketStream(s.url, { protocols: ["first", "second"] });
  const { writable, protocol } = await stream.opened;
  assert.equal(protocol, "");
  const closing = writable.getWriter().close();
  await stream.closed;
  await closing;
});

suite("permessage-deflate preserves context across fragmented messages", async (t) => {
  const serverDeflater = createDeflateRaw({ chunkSize: 65536, windowBits: 15 });
  const serverInflater = createInflateRaw({ chunkSize: 65536, windowBits: 15 });
  t.after(() => {
    serverDeflater.destroy();
    serverInflater.destroy();
  });
  let serverError = null;
  const original = "context takeover makes this repeated message smaller ".repeat(20);
  let firstWireSize = 0;
  let secondWireSize = 0;
  let messageNumber = 0;
  let opcode = 0;
  let compressed = false;
  let parts = [];
  let pong = false;

  const s = await websocketServer(
    t,
    (socket, request) => {
      assert.equal(request.headers["sec-websocket-extensions"], "permessage-deflate");
      peerParser(socket, (incoming) => {
        if (incoming.opcode === 10) {
          pong = true;
          return;
        }
        if (incoming.opcode === 8) {
          socket.end(frame(8, incoming.payload));
          return;
        }
        if (incoming.opcode !== 0) {
          opcode = incoming.opcode;
          compressed = incoming.compressed;
          parts = [];
        } else {
          assert.equal(incoming.compressed, false, "RSV1 is clear on continuation frames");
        }
        parts.push(incoming.payload);
        if (!incoming.fin) return;
        void (async () => {
          assert.equal(opcode, 1);
          assert.equal(compressed, true);
          const wire = Buffer.concat(parts);
          messageNumber++;
          if (messageNumber === 1) firstWireSize = wire.length;
          else secondWireSize = wire.length;
          const inflated = await zlibMessage(
            serverInflater,
            Buffer.concat([wire, Buffer.from([0, 0, 255, 255])]),
          );
          assert.equal(inflated.toString(), original);
          const echoed = stripDeflateTail(await zlibMessage(serverDeflater, inflated));
          const split = Math.max(1, Math.floor(echoed.length / 2));
          socket.write(
            Buffer.concat([
              frame(1, echoed.subarray(0, split), false, true),
              frame(9, Buffer.from("compressed-ping")),
              frame(0, echoed.subarray(split), true),
            ]),
          );
        })().catch((error) => {
          serverError = error;
          socket.destroy();
        });
      });
    },
    { extra: "Sec-WebSocket-Extensions: permessage-deflate\r\n" },
  );

  runtime(t, { websocket: { outgoingFrameBytes: 2 } });
  const stream = new WebSocketStream(s.url);
  const { readable, writable, extensions } = await stream.opened;
  assert.equal(extensions, "permessage-deflate");
  const reader = readable.getReader();
  const writer = writable.getWriter();
  await writer.write(original);
  assert.deepEqual(await reader.read(), { done: false, value: original });
  await writer.write(original);
  assert.deepEqual(await reader.read(), { done: false, value: original });
  assert.equal(secondWireSize < firstWireSize, true, "the second message must reuse LZ77 context");
  assert.equal(pong, true, "control frames remain uncompressed and interleave with fragments");
  const closing = writer.close();
  await stream.closed;
  await closing;
  if (serverError !== null) throw serverError;
});

suite("permessage-deflate resets negotiated contexts and bounds inflation", async (t) => {
  const original = "no context takeover ".repeat(20);
  const wireMessages = [];
  let parts = [];
  let compressed = false;
  const s = await websocketServer(
    t,
    (socket) =>
      peerParser(socket, (incoming) => {
        if (incoming.opcode === 8) {
          socket.end(frame(8, incoming.payload));
          return;
        }
        if (incoming.opcode !== 0) {
          parts = [];
          compressed = incoming.compressed;
        }
        parts.push(incoming.payload);
        if (!incoming.fin) return;
        assert.equal(compressed, true);
        const wire = Buffer.concat(parts);
        wireMessages.push(wire);
        const plain = inflateMessage(wire);
        assert.equal(plain.toString(), wireMessages.length <= 2 ? original : "");
        socket.write(frame(1, deflateMessage(plain, 10), true, true));
      }),
    {
      extra:
        "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover; server_max_window_bits=10\r\n",
    },
  );
  runtime(t, { websocket: { outgoingFrameBytes: 3 } });
  const stream = new WebSocketStream(s.url);
  const { readable, writable } = await stream.opened;
  const reader = readable.getReader();
  const writer = writable.getWriter();
  await writer.write(original);
  assert.deepEqual(await reader.read(), { done: false, value: original });
  await writer.write(original);
  assert.deepEqual(await reader.read(), { done: false, value: original });
  assert.deepEqual(
    wireMessages[1],
    wireMessages[0],
    "client context must reset after each message",
  );
  await writer.write("");
  assert.deepEqual(await reader.read(), { done: false, value: "" });
  assert.equal(wireMessages[2].length <= 1, true, "empty compression adds no data payload");
  const closing = writer.close();
  await stream.closed;
  await closing;

  let closeCode = 0;
  const receivedClose = Promise.withResolvers();
  const bomb = await websocketServer(
    t,
    (socket) => {
      peerParser(socket, (incoming) => {
        if (incoming.opcode !== 8) return;
        closeCode = incoming.payload.readUInt16BE();
        receivedClose.resolve();
        socket.end(frame(8, incoming.payload));
      });
      socket.write(frame(2, deflateMessage(Buffer.alloc(4096, 65)), true, true));
    },
    { extra: "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover\r\n" },
  );
  const bombRuntime = runtime(t, { websocket: { maxMessageBytes: 64 } });
  const socket = bombRuntime.createWebSocket(bomb.url);
  const events = wsEvents(socket);
  const closed = await events.closed;
  await receivedClose.promise;
  assert.equal(closeCode, 1009);
  assert.equal(closed.code, 1006);
  assert.deepEqual(events.log, ["open", "error", "close"]);
});

for (const [name, payload, expectedCode] of [
  ["invalid DEFLATE", Buffer.from([255]), 1002],
  ["invalid decompressed UTF-8", deflateMessage(Buffer.from([255])), 1007],
]) {
  suite("permessage-deflate rejects " + name, async (t) => {
    const closeCode = Promise.withResolvers();
    const s = await websocketServer(
      t,
      (socket) => {
        peerParser(socket, (incoming) => {
          if (incoming.opcode !== 8) return;
          closeCode.resolve(incoming.payload.readUInt16BE());
          socket.end(frame(8, incoming.payload));
        });
        socket.write(frame(1, payload, true, true));
      },
      { extra: "Sec-WebSocket-Extensions: permessage-deflate\r\n" },
    );
    const api = runtime(t);
    const socket = api.createWebSocket(s.url);
    const events = wsEvents(socket);
    const closed = await events.closed;
    assert.equal(await closeCode.promise, expectedCode);
    assert.equal(closed.code, 1006);
    assert.deepEqual(events.log, ["open", "error", "close"]);
  });
}
suite("WebSocket masked sends, independent echo, subprotocol, clean close", async (t) => {
  const s = await websocketServer(
    t,
    (socket) =>
      peerParser(socket, (f) => {
        if (f.opcode === 8) socket.end(frame(8, f.payload));
        else socket.write(frame(f.opcode, f.payload, f.fin));
      }),
    { extra: "Sec-WebSocket-Protocol: chat\r\n" },
  );
  const api = runtime(t);
  const ws = api.createWebSocket(s.url, ["chat"]);
  const e = wsEvents(ws);
  assert.throws(() => ws.send("early"));
  await e.opened;
  assert.equal(ws.protocol, "chat");
  const message = new Promise((resolve) => (ws.onmessage = resolve));
  ws.send("hello 💙");
  assert.equal(ws.bufferedAmount, 10);
  assert.equal((await message).data, "hello 💙");
  ws.close(1000, "bye");
  const closed = await e.closed;
  assert.equal(closed.code, 1000);
  assert.equal(closed.reason, "bye");
  assert.equal(closed.wasClean, true);
  assert.deepEqual(e.log, ["open", "close"]);
});
suite("WebSocket applies Web IDL conversion before public close validation", async (t) => {
  const s = await websocketServer(t, (socket) =>
    peerParser(socket, (f) => {
      if (f.opcode === 8) socket.end(frame(8, f.payload));
      else socket.write(frame(f.opcode, f.payload, f.fin));
    }),
  );
  const api = runtime(t);
  const ws = api.createWebSocket(s.url);
  const e = wsEvents(ws);
  await e.opened;

  assert.throws(
    () => ws.close(4999.5),
    (error) => error.name === "InvalidAccessError",
  );
  const message = new Promise((resolve) => (ws.onmessage = resolve));
  ws.send("\ud800");
  assert.equal((await message).data, "\ufffd");

  ws.close(2999.5, "\ud800");
  const closed = await e.closed;
  assert.equal(closed.code, 3000);
  assert.equal(closed.reason, "\ufffd");
  assert.equal(closed.wasClean, true);
});
suite("WebSocket fragmented UTF-8 with interleaved ping and pong", async (t) => {
  let pong;
  const pongReceived = new Promise((resolve) => (pong = resolve));
  const s = await websocketServer(t, (socket) => {
    peerParser(socket, (f) => {
      if (f.opcode === 10) pong(f.payload.toString());
      if (f.opcode === 8) socket.end(frame(8, f.payload));
    });
    const bytes = Buffer.from("€💙");
    socket.write(
      Buffer.concat([
        frame(1, bytes.subarray(0, 2), false),
        frame(9, Buffer.from("ping")),
        frame(0, bytes.subarray(2), true),
      ]),
    );
  });
  const api = runtime(t);
  const ws = api.createWebSocket(s.url);
  const e = wsEvents(ws);
  const message = new Promise((resolve) => (ws.onmessage = resolve));
  assert.equal((await message).data, "€💙");
  assert.equal(await pongReceived, "ping");
  ws.close(1000);
  await e.closed;
});
suite("WebSocket binary snapshots, ordered sends, application send fragmentation", async (t) => {
  const seen = [];
  let done;
  const all = new Promise((r) => (done = r));
  const s = await websocketServer(t, (socket) =>
    peerParser(socket, (f) => {
      if (f.opcode === 8) {
        socket.end(frame(8, f.payload));
        return;
      }
      seen.push(f);
      if (f.fin) {
        socket.write(frame(2, Buffer.concat(seen.map((x) => x.payload))));
        done();
      }
    }),
  );
  const api = runtime(t, { websocket: { outgoingFrameBytes: 2 } });
  const ws = api.createWebSocket(s.url);
  ws.binaryType = "arraybuffer";
  const e = wsEvents(ws);
  await e.opened;
  const msg = new Promise((r) => (ws.onmessage = r));
  const input = Uint8Array.of(1, 2, 3, 4, 5);
  ws.send(input);
  input.fill(9);
  await all;
  assert.deepEqual(new Uint8Array((await msg).data), Uint8Array.of(1, 2, 3, 4, 5));
  assert.deepEqual(
    seen.map((x) => [x.opcode, x.fin]),
    [
      [2, false],
      [0, false],
      [0, true],
    ],
  );
  ws.close();
  await e.closed;
});
suite("WebSocket snapshots the exact byte range of every ArrayBufferView", async (t) => {
  let parts = [];
  const s = await websocketServer(t, (socket) =>
    peerParser(socket, (incoming) => {
      if (incoming.opcode === 8) {
        socket.end(frame(8, incoming.payload));
        return;
      }
      if (incoming.opcode !== 0) parts = [];
      parts.push(incoming.payload);
      if (incoming.fin) socket.write(frame(2, Buffer.concat(parts)));
    }),
  );
  const api = runtime(t);
  const ws = api.createWebSocket(s.url);
  ws.binaryType = "arraybuffer";
  const events = wsEvents(ws);
  await events.opened;
  const received = [];
  const complete = new Promise((resolve) => {
    ws.onmessage = (event) => {
      received.push(new Uint8Array(event.data));
      if (received.length === 2) resolve();
    };
  });

  const dataViewBacking = Uint8Array.of(99, 1, 2, 3, 4, 99);
  ws.send(new DataView(dataViewBacking.buffer, 1, 4));
  dataViewBacking.fill(8);

  const wideViewBacking = Uint8Array.of(99, 99, 5, 6, 7, 8, 99, 99);
  ws.send(new Uint16Array(wideViewBacking.buffer, 2, 2));
  wideViewBacking.fill(9);

  assert.equal(ws.bufferedAmount, 8);
  await complete;
  assert.deepEqual(received, [Uint8Array.of(1, 2, 3, 4), Uint8Array.of(5, 6, 7, 8)]);
  ws.close();
  await events.closed;
});
for (const [name, options] of [
  ["invalid accept", { badAccept: true }],
  ["unsolicited extension", { extra: "Sec-WebSocket-Extensions: permessage-deflate\r\n" }],
  ["unsolicited protocol", { extra: "Sec-WebSocket-Protocol: other\r\n" }],
])
  suite("WebSocket rejects " + name, async (t) => {
    const s = await websocketServer(t, () => {}, options);
    const api = runtime(t, name === "unsolicited extension" ? { webSocketDeflate: null } : {});
    const ws = api.createWebSocket(s.url);
    const e = wsEvents(ws);
    const close = await e.closed;
    assert.equal(close.code, 1006);
    assert.equal(close.wasClean, false);
    assert.deepEqual(e.log, ["error", "close"]);
  });
for (const [name, wire, expected, limits] of [
  ["invalid UTF-8", frame(1, Buffer.from([255])), 1007, {}],
  ["masked server frame", Buffer.from([0x81, 0x80, 0, 0, 0, 0]), 1002, {}],
  ["oversize message", frame(2, Buffer.alloc(20)), 1009, { maxMessageBytes: 4 }],
  [
    "fragment count",
    Buffer.concat([
      frame(1, Buffer.alloc(0), false),
      frame(0, Buffer.alloc(0), false),
      frame(0, Buffer.alloc(0), true),
    ]),
    1009,
    { maxFragments: 2 },
  ],
])
  suite("WebSocket protocol failure: " + name, async (t) => {
    let closeCode;
    const received = new Promise((resolve) => (closeCode = resolve));
    const s = await websocketServer(t, (socket) => {
      peerParser(socket, (f) => {
        if (f.opcode === 8) {
          closeCode(f.payload.readUInt16BE());
          socket.end(frame(8, f.payload));
        }
      });
      socket.write(wire);
    });
    const api = runtime(t, { websocket: limits });
    const ws = api.createWebSocket(s.url);
    const e = wsEvents(ws);
    const closed = await e.closed;
    assert.equal(await received, expected);
    assert.equal(closed.code, 1006);
    assert.deepEqual(e.log, ["open", "error", "close"]);
  });
suite("WebSocket close timeout, close during connect, runtime shutdown", async (t) => {
  const s = await websocketServer(t, () => {});
  const api = runtime(t, { websocket: { closeTimeoutMs: 30 } });
  const ws = api.createWebSocket(s.url);
  const e = wsEvents(ws);
  await e.opened;
  ws.close(1000);
  assert.equal((await e.closed).wasClean, false);
  const connecting = api.createWebSocket(s.url);
  const ce = wsEvents(connecting);
  connecting.close();
  assert.equal((await ce.closed).code, 1006);
  assert.deepEqual(ce.log, ["error", "close"]);
  const live = api.createWebSocket(s.url);
  const le = wsEvents(live);
  await le.opened;
  api.close();
  assert.equal((await le.closed).code, 1006);
});
suite("TLS: HTTPS and WSS trust validation, custom root and hostname mismatch", async (t) => {
  const fixture = tlsFixture();
  const s = await server(t, (_req, res) => res.end("secure"), false, true);
  const trusted = runtime(t, {}, { ca: fixture.cert.toString("utf8") });
  assert.equal(await (await trusted.fetch(s.url)).text(), "secure");
  const untrusted = runtime(t);
  await assert.rejects(untrusted.fetch(s.url));
  // The fixture certificate has only IP:127.0.0.1, not DNS:localhost.
  await assert.rejects(trusted.fetch(s.url.replace("127.0.0.1", "localhost")), (error) =>
    /altname|altnames|Hostname\/IP/i.test(errorChain(error)),
  );
  const wss = await websocketServer(
    t,
    (socket) =>
      peerParser(socket, (f) => {
        if (f.opcode === 8) socket.end(frame(8, f.payload));
      }),
    { secure: true },
  );
  const ws = trusted.createWebSocket(wss.url);
  const e = wsEvents(ws);
  await e.opened;
  ws.close(1000);
  assert.equal((await e.closed).wasClean, true);
});

suite("EventSource reconnects through the real HTTP transport", async (t) => {
  let requests = 0;
  const headers = [];
  const s = await server(t, (req, res) => {
    requests++;
    headers.push(req.headers);
    if (requests === 1) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const message = Buffer.from("data: Καλημέρα\nid: live-1\nretry: 0\n\n");
      res.write(message.subarray(0, 9));
      res.end(message.subarray(9));
    } else {
      res.writeHead(204);
      res.end();
    }
  });
  const api = runtime(t, { eventSource: { initialReconnectDelayMs: 60_000 } });
  const source = new EventSource(s.url + "/events");
  const message = Promise.withResolvers();
  const failed = Promise.withResolvers();
  source.onmessage = (event) => message.resolve(event);
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) failed.resolve();
  };

  const event = await message.promise;
  await failed.promise;
  assert.equal(event.data, "Καλημέρα");
  assert.equal(event.lastEventId, "live-1");
  assert.equal(event.origin, s.url);
  assert.equal(headers[0].accept, "text/event-stream");
  assert.equal(headers[0]["last-event-id"], undefined);
  assert.equal(headers[1]["last-event-id"], "live-1");
  assert.equal(api.http1.pool.stats.idle, 1);
});
