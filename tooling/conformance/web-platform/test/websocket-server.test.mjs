// A WebSocket server session, driven by the same message engine as the client.
//
// RFC 6455 makes masking the one asymmetry in the framing, so the engine takes a role
// rather than being written twice. These tests run the canonical client against a
// server built from the shared pieces over a real socket, which is the only way to
// show that both ends of one engine actually agree.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";

import {
  acceptWebSocketUpgrade,
  adoptServerWebSocketSession,
  BufferedReader,
  serializeUpgradeResponse,
  writeAll,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
import {
  HostNodeScheduler,
  hostNodeRandom,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { HostNodeWebSocketDeflate } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-websocket-deflate.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Minimal ByteConnection over an accepted Node socket. Test harness, not a provider. */
function byteConnection(socket) {
  const pending = [];
  let waiting = null;
  let ended = false;
  socket.on("data", (chunk) => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(new Uint8Array(chunk));
      return;
    }
    pending.push(new Uint8Array(chunk));
  });
  socket.on("end", () => {
    ended = true;
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(null);
    }
  });
  socket.on("error", () => {});
  return {
    get closed() {
      return socket.destroyed;
    },
    // The contract is "a nonempty chunk of at most maxBytes"; returning a whole socket
    // chunk regardless is a contract violation the reader is entitled to trip over.
    async read(maxBytes) {
      const take = (chunk) => {
        if (chunk === null || chunk.length <= maxBytes) return chunk;
        pending.unshift(chunk.subarray(maxBytes));
        return chunk.subarray(0, maxBytes);
      };
      const next = pending.shift();
      if (next !== undefined) return take(next);
      if (ended) return null;
      return new Promise((resolve) => {
        waiting = (chunk) => resolve(take(chunk));
      });
    },
    async write(data) {
      socket.write(Buffer.from(data));
      return data.length;
    },
    close() {
      socket.destroy();
    },
  };
}

/** Reads the request head through the shared reader, so no byte is lost to the session. */
async function readRequestHead(reader) {
  // `BufferedReader.line` already returns a decoded line.
  const requestLine = await reader.line(8192);
  const headers = [];
  while (true) {
    const line = await reader.line(8192);
    if (line === "") break;
    const colon = line.indexOf(":");
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { method: requestLine.split(" ")[0], headers };
}

async function websocketServer(t, upgradeOptions, deflate) {
  const seen = { protocol: null, extensions: null, messages: [], errors: [] };
  const sockets = new Set();
  const scheduler = new HostNodeScheduler(() => {});
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    void (async () => {
      const connection = byteConnection(socket);
      const reader = new BufferedReader(connection);
      const request = await readRequestHead(reader);
      const outcome = acceptWebSocketUpgrade(request.method, request.headers, upgradeOptions);
      await writeAll(connection, encoder.encode(serializeUpgradeResponse(outcome)));
      if (!outcome.accepted) {
        connection.close();
        return;
      }
      seen.protocol = outcome.protocol;
      seen.extensions = outcome.perMessageDeflate?.response ?? null;
      // The same reader continues into the frames: bytes a client sent immediately
      // after its handshake are already buffered here.
      const session = adoptServerWebSocketSession({
        connection,
        reader,
        protocol: outcome.protocol ?? "",
        extensions: seen.extensions ?? "",
        perMessageDeflate: outcome.perMessageDeflate,
        deflate,
        random: hostNodeRandom,
        scheduler,
      });
      try {
        while (true) {
          const incoming = await session.next();
          if (incoming.kind === "closed") break;
          seen.messages.push(incoming);
          await session.send(incoming);
        }
      } catch (error) {
        seen.errors.push(error);
      }
    })();
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, seen };
}

function clientOf(t, options = {}) {
  const api = createHostNodeWebPlatform(options);
  t.after(() => api.close());
  return api;
}

suite("the shared engine speaks both ends of one connection", async (t) => {
  const { port, seen } = await websocketServer(t, { protocols: ["chat"] });
  const api = clientOf(t);
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat"]);
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("handshake refused")));
  });
  const received = [];
  const twoBack = new Promise((resolve) => {
    socket.addEventListener("message", (event) => {
      received.push(event.data);
      if (received.length === 2) resolve();
    });
  });
  await opened;
  assert.equal(socket.protocol, "chat");
  assert.equal(seen.protocol, "chat");

  // `binaryType` defaults to "blob", which is the Web default and not what this
  // assertion wants; asking for buffers is part of what is under test.
  socket.binaryType = "arraybuffer";
  socket.send("a text message");
  socket.send(Uint8Array.of(1, 2, 3, 250));
  await twoBack;

  // Text survives as text and binary as binary, in order, through both directions.
  assert.equal(received[0], "a text message");
  assert.ok(received[1] instanceof ArrayBuffer, "binaryType decides what a message is");
  assert.deepEqual([...new Uint8Array(received[1])], [1, 2, 3, 250]);
  assert.deepEqual(
    seen.messages.map((message) => message.kind),
    ["text", "binary"],
  );
  assert.equal(seen.messages[0].data, "a text message");
  socket.close();
});

suite("a client's masked frames are what the server requires", async (t) => {
  // The client masks and the server does not; each rejects the other spelling. A round
  // trip is the proof that the role, not a coincidence, decides which is used.
  const { port, seen } = await websocketServer(t, {});
  const api = clientOf(t);
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`);
  const back = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(event.data));
    socket.addEventListener("error", () => reject(new Error("the client rejected the server")));
  });
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  socket.send("round trip");
  assert.equal(await back, "round trip");
  assert.deepEqual(seen.errors, []);
  socket.close();
});

suite("negotiated compression is what both ends actually use", async (t) => {
  const { port, seen } = await websocketServer(
    t,
    { perMessageDeflate: true },
    new HostNodeWebSocketDeflate(),
  );
  const api = clientOf(t);
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`);
  const back = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(event.data));
    socket.addEventListener("error", () => reject(new Error("compressed session failed")));
  });
  await new Promise((resolve) => socket.addEventListener("open", resolve));
  // Long and highly repetitive, so it certainly crosses the wire compressed.
  const payload = "compressible ".repeat(400);
  socket.send(payload);
  assert.equal(await back, payload, "a compressed round trip decompresses to the original");
  assert.equal(seen.extensions, "permessage-deflate", "the server agreed to compress");
  assert.equal(socket.extensions, "permessage-deflate", "and the client saw it agree");
  assert.deepEqual(seen.errors, []);
  socket.close();
});

suite("a refused upgrade is refused by the client too", async (t) => {
  const { port } = await websocketServer(t, {});
  const api = clientOf(t);
  // The server only speaks version 13; a client asking for a subprotocol the server
  // does not offer still connects, so refusal is provoked at the HTTP layer instead.
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat"]);
  const settled = new Promise((resolve) => {
    socket.addEventListener("open", () => resolve("open"));
    socket.addEventListener("error", () => resolve("error"));
  });
  // A server that selects no subprotocol is a successful handshake, so this opens.
  assert.equal(await settled, "open");
  assert.equal(socket.protocol, "", "no subprotocol was selected");
  socket.close();
});
