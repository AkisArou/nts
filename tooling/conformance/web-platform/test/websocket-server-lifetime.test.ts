// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// The WebSocket server's lifetime owner.
//
// Not an accept loop: listening, TLS and HTTP parsing belong to the server this is
// embedded in. What does not exist elsewhere is something that knows how many sessions
// are open, refuses when that is too many, and can close all of them once. These tests
// drive it with the canonical client over real sockets.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";

import {
  BufferedReader,
  WebSocketServer,
} from "../../../../runtime/web-platform/src/provider.ts";
import { createHostNodeWebPlatform } from "../node-runtime.ts";
import {
  HostNodeScheduler,
  hostNodeRandom,
} from "../node-primitives.ts";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const decoder = new TextDecoder();

/** Minimal ByteConnection over an accepted Node socket, honouring maxBytes. */
function byteConnection(socket) {
  const pending = [];
  let waiting = null;
  let ended = false;
  const deliver = (chunk) => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve(chunk);
      return;
    }
    if (chunk !== null) pending.push(chunk);
    else ended = true;
  };
  socket.on("data", (chunk) => deliver(new Uint8Array(chunk)));
  socket.on("end", () => {
    ended = true;
    deliver(null);
  });
  socket.on("error", () => {});
  return {
    get closed() {
      return socket.destroyed;
    },
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

async function readRequestHead(reader) {
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

/** Runs a WebSocketServer behind a real listener and echoes whatever arrives. */
async function hosted(t, serverOptions = {}) {
  const server = new WebSocketServer({
    random: hostNodeRandom,
    scheduler: new HostNodeScheduler(() => {}),
    ...serverOptions,
  });
  const refusals = [];
  const sockets = new Set();
  const listener = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    void (async () => {
      const connection = byteConnection(socket);
      const reader = new BufferedReader(connection);
      const request = await readRequestHead(reader);
      const result = await server.upgrade(request.method, request.headers, connection, reader);
      if (!result.accepted) {
        refusals.push(result.status);
        return;
      }
      try {
        while (true) {
          const incoming = await result.session.next();
          if (incoming.kind === "close") break;
          await result.session.send(incoming);
        }
      } catch {
        // A server closing under a live session is an ordinary ending here.
      }
    })();
  });
  listener.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  t.after(() => {
    server.destroy();
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => listener.close(resolve));
  });
  return { server, port: listener.address().port, refusals };
}

function clientFor(t) {
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  return api;
}

async function connected(api, port, protocols) {
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, protocols ?? []);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("handshake refused")));
  });
  return socket;
}

suite("the server counts the sessions it is holding", async (t) => {
  const { server, port } = await hosted(t, { protocols: ["chat"] });
  const api = clientFor(t);
  assert.equal(server.connections, 0);

  const first = await connected(api, port, ["chat"]);
  const second = await connected(api, port, ["chat"]);
  assert.equal(server.connections, 2);
  assert.equal(first.protocol, "chat");

  // A round trip proves the counted sessions are the live ones.
  const back = new Promise((resolve) => first.addEventListener("message", (e) => resolve(e.data)));
  first.send("still here");
  assert.equal(await back, "still here");

  const closed = new Promise((resolve) => second.addEventListener("close", resolve));
  second.close();
  await closed;
  // The session removes itself when it ends, without the server being told.
  for (let turn = 0; turn < 40 && server.connections !== 1; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(server.connections, 1, "a session that ends stops being held");
  first.close();
});

suite("the connection bound is enforced with a response, not a dropped socket", async (t) => {
  const { server, port, refusals } = await hosted(t, { maxConnections: 1 });
  const api = clientFor(t);
  const first = await connected(api, port);
  assert.equal(server.connections, 1);

  // The second upgrade is refused above the bound.
  const second = api.createWebSocket(`ws://127.0.0.1:${port}/`);
  const outcome = await new Promise((resolve) => {
    second.addEventListener("open", () => resolve("open"));
    second.addEventListener("error", () => resolve("error"));
  });
  assert.equal(outcome, "error", "a client above the bound must be turned away");
  assert.deepEqual(refusals, [503], "and told why, rather than left to time out");
  assert.equal(server.connections, 1, "the refusal did not become a held session");
  first.close();
});

suite("close reaches every open session and settles once", async (t) => {
  const { server, port } = await hosted(t);
  const api = clientFor(t);
  const sockets = [await connected(api, port), await connected(api, port)];
  assert.equal(server.connections, 2);

  const closes = sockets.map(
    (socket) =>
      new Promise((resolve) => socket.addEventListener("close", (event) => resolve(event))),
  );
  // Two callers share one shutdown rather than starting a second.
  const first = server.close();
  const second = server.close();
  assert.equal(first, second, "repeated close is one shutdown");
  await first;
  assert.equal(server.connections, 0);
  assert.equal(server.accepting, false);

  const events = await Promise.all(closes);
  for (const event of events) {
    assert.equal(event.code, 1001, "a closing server says it is going away");
    assert.equal(event.wasClean, true, "and closes cleanly rather than dropping the socket");
  }
});

suite("a closing server refuses new upgrades", async (t) => {
  const { server, port, refusals } = await hosted(t);
  const api = clientFor(t);
  await server.close();
  assert.equal(server.accepting, false);

  const late = api.createWebSocket(`ws://127.0.0.1:${port}/`);
  const outcome = await new Promise((resolve) => {
    late.addEventListener("open", () => resolve("open"));
    late.addEventListener("error", () => resolve("error"));
  });
  assert.equal(outcome, "error");
  assert.deepEqual(refusals, [503]);
  assert.equal(server.connections, 0);
});

suite("an invalid connection bound is refused at construction", () => {
  const base = { random: hostNodeRandom, scheduler: new HostNodeScheduler(() => {}) };
  for (const bound of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new WebSocketServer({ ...base, maxConnections: bound }), RangeError);
  }
  assert.equal(new WebSocketServer({ ...base, maxConnections: 1 }).connections, 0);
});
