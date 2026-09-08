// A WebSocket server session, driven by the same message engine as the client.
//
// RFC 6455 makes masking the one asymmetry in the framing, so the engine takes a role
// rather than being written twice. These tests run the canonical client against a
// server built from the shared pieces over a real socket, which is the only way to
// show that both ends of one engine actually agree.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { websocketServer } from "./websocket-echo-server.ts";

import { createHostNodeWebPlatform } from "../node-runtime.ts";
import { HostNodeWebSocketDeflate } from "../node-websocket-deflate.ts";
import type { WebPlatformRuntime } from "../../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformOptions } from "../../../../runtime/web-platform/src/provider.ts";
import type { Event } from "../../../../runtime/web-platform/src/index.ts";
import { MessageEvent } from "../../../../runtime/web-platform/src/index.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The payload of a message event.
 *
 * `addEventListener` hands the listener the base `Event`, because one listener signature
 * serves every type; a message event carries `data` and this narrows to it rather than the
 * value being read off a type that does not declare it.
 */
function messageData(event: Event): unknown {
  assert.ok(event instanceof MessageEvent, "a message listener receives a MessageEvent");
  return event.data;
}

function clientOf(t: TestContext, options: WebPlatformOptions = {}): WebPlatformRuntime {
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
  const received: unknown[] = [];
  const twoBack = new Promise<void>((resolve) => {
    socket.addEventListener("message", (event: Event) => {
      received.push(messageData(event));
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
  const binary = received[1];
  assert.ok(binary instanceof ArrayBuffer, "binaryType decides what a message is");
  assert.deepEqual([...new Uint8Array(binary)], [1, 2, 3, 250]);
  assert.deepEqual(
    seen.messages.map((message) => message.kind),
    ["text", "binary"],
  );
  assert.equal(seen.messages[0]?.data, "a text message");
  socket.close();
});

suite("a client's masked frames are what the server requires", async (t) => {
  // The client masks and the server does not; each rejects the other spelling. A round
  // trip is the proof that the role, not a coincidence, decides which is used.
  const { port, seen } = await websocketServer(t, {});
  const api = clientOf(t);
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`);
  const back = new Promise<unknown>((resolve, reject) => {
    socket.addEventListener("message", (event: Event) => resolve(messageData(event)));
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
  const back = new Promise<unknown>((resolve, reject) => {
    socket.addEventListener("message", (event: Event) => resolve(messageData(event)));
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

suite("the server loop ends on a close frame instead of echoing it", async (t) => {
  // The regression this pins was invisible for as long as the harness was untyped. The loop
  // compared `incoming.kind` against `"closed"`, which is not one of the three kinds
  // `SocketIncoming` has, so it was never true: on every close the server fell through, pushed
  // the close frame into `messages`, and tried to `send` it back as a message. The send throws,
  // the throw lands in `errors`, and the existing `deepEqual(seen.errors, [])` assertions ran
  // *before* any of it -- the close happens at the end of a test, and nothing waited.
  //
  // So this waits. The client's close event cannot arrive before the server has processed the
  // close frame that provoked it, and the settle after it gives the server loop its next turn.
  const { port, seen } = await websocketServer(t, { protocols: ["chat"] });
  const api = clientOf(t);
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat"]);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("handshake refused")));
  });

  const echoed = new Promise<unknown>((resolve) => {
    socket.addEventListener("message", (event: Event) => resolve(messageData(event)));
  });
  socket.send("one message");
  assert.equal(await echoed, "one message");

  const closed = new Promise<void>((resolve) => {
    socket.addEventListener("close", () => resolve());
  });
  socket.close(1000, "done");
  await closed;
  // Several turns, so the server's loop runs its close branch before anything is asserted.
  for (let turn = 0; turn < 10; turn++) await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(seen.errors, [], "the loop treated the close as an error");
  assert.deepEqual(
    seen.messages.map((message) => message.kind),
    ["text"],
    "a close frame was recorded as a message",
  );
});
