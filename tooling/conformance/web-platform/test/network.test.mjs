// Adapted from the verified external delivery after removing its synthetic realm API.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import https from "node:https";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync, deflateSync } from "node:zlib";
import { once } from "node:events";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
import {
  ReadableStream,
  AbortController,
  TextEncoder,
  Response,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { ConnectionPool } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/pool.js";
import { createHostNodePrimitives } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { tlsFixture } from "./tls-fixture.mjs";

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
const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
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
  const response = await api.fetch(s.url, { method: "POST", body: "Καλημέρα" });
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
  assert.equal(body.disturbed, true);
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
      "HTTP/1.1 103 Early Hints\r\nLink: </x>\r\n\r\nHTTP/1.1 200 Yep\r\nTransfer-Encoding: chunked\r\nSet-Cookie: a\r\nX-B: 2\r\nSet-Cookie: b\r\n\r\n3;x=y\r\nabc\r\n0\r\n\r\n";
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
          signal.subscribe(() => {
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

// Independent test-server frame encoder/parser. These do not call the implementation's codec.
function frame(opcode, payload = Buffer.alloc(0), fin = true) {
  const bytes = Buffer.from(payload);
  const head = Buffer.alloc(bytes.length < 126 ? 2 : bytes.length <= 65535 ? 4 : 10);
  head[0] = (fin ? 128 : 0) | opcode;
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
      onFrame({ opcode: first & 15, fin: !!(first & 128), payload });
    }
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
  assert.ok(ws.bufferedAmount > 0);
  assert.equal((await message).data, "hello 💙");
  ws.close(1000, "bye");
  const closed = await e.closed;
  assert.equal(closed.code, 1000);
  assert.equal(closed.reason, "bye");
  assert.equal(closed.wasClean, true);
  assert.deepEqual(e.log, ["open", "close"]);
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
for (const [name, options] of [
  ["invalid accept", { badAccept: true }],
  ["unsolicited extension", { extra: "Sec-WebSocket-Extensions: permessage-deflate\r\n" }],
  ["unsolicited protocol", { extra: "Sec-WebSocket-Protocol: other\r\n" }],
])
  suite("WebSocket rejects " + name, async (t) => {
    const s = await websocketServer(t, () => {}, options);
    const api = runtime(t);
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
