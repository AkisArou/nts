// The plan requires a WebSocket server as a Node/server extension. This is its
// handshake: validating an upgrade request and producing the response, with no I/O of
// its own, because reading the request and taking over the connection belong to
// whatever HTTP server it is embedded in.
//
// The end-to-end case runs our own client against a server built on it, which is the
// only way to show the handshake is one a real client accepts rather than one that
// merely looks right.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { createHash } from "node:crypto";

import {
  acceptWebSocketUpgrade,
  serializeUpgradeResponse,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const KEY = Buffer.alloc(16, 7).toString("base64");

function headersOf(overrides = {}) {
  const base = {
    host: "example.test",
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": KEY,
    ...overrides,
  };
  return Object.entries(base).filter(([, value]) => value !== undefined);
}

function headerValue(outcome, name) {
  for (const [key, value] of outcome.headers) if (key === name) return value;
  return null;
}

suite("a valid upgrade is accepted with the derived accept value", () => {
  const outcome = acceptWebSocketUpgrade("GET", headersOf());
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.status, 101);
  assert.equal(outcome.statusText, "Switching Protocols");
  assert.equal(headerValue(outcome, "upgrade"), "websocket");
  assert.equal(headerValue(outcome, "connection"), "Upgrade");
  // The accept value is the RFC's fixed derivation, checked against an independent
  // implementation rather than against our own.
  const expected = createHash("sha1")
    .update(KEY + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  assert.equal(headerValue(outcome, "sec-websocket-accept"), expected);
  assert.equal(outcome.protocol, null);
  assert.equal(headerValue(outcome, "sec-websocket-protocol"), null);
  // Extensions are declined rather than echoed.
  assert.equal(headerValue(outcome, "sec-websocket-extensions"), null);
});

suite("a malformed request is refused with a real response", () => {
  const notGet = acceptWebSocketUpgrade("POST", headersOf());
  assert.equal(notGet.accepted, false);
  assert.equal(notGet.status, 405);
  assert.equal(headerValue(notGet, "allow"), "GET");

  const noUpgrade = acceptWebSocketUpgrade("GET", headersOf({ upgrade: undefined }));
  assert.equal(noUpgrade.status, 400);
  const wrongUpgrade = acceptWebSocketUpgrade("GET", headersOf({ upgrade: "h2c" }));
  assert.equal(wrongUpgrade.status, 400);
  const noConnection = acceptWebSocketUpgrade("GET", headersOf({ connection: "keep-alive" }));
  assert.equal(noConnection.status, 400);

  // Every refusal closes rather than leaving a half-upgraded connection open.
  for (const outcome of [notGet, noUpgrade, wrongUpgrade, noConnection]) {
    assert.equal(headerValue(outcome, "connection"), "close");
    assert.equal(headerValue(outcome, "sec-websocket-accept"), null);
  }
});

suite("a token list is honoured rather than compared whole", () => {
  // Real clients and proxies send lists; `Connection: keep-alive, Upgrade` is valid.
  const listed = acceptWebSocketUpgrade(
    "GET",
    headersOf({ connection: "keep-alive, Upgrade", upgrade: "WebSocket" }),
  );
  assert.equal(listed.accepted, true, "tokens are case-insensitive and may be listed");
});

suite("an unsupported version advertises the one that is supported", () => {
  for (const version of [undefined, "8", "12", "14", ""]) {
    const outcome = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-version": version }));
    assert.equal(outcome.accepted, false);
    assert.equal(outcome.status, 426);
    // Without this a client cannot know what to retry with.
    assert.equal(headerValue(outcome, "sec-websocket-version"), "13");
  }
});

suite("the key must be sixteen base64 bytes", () => {
  const bad = [
    undefined,
    "",
    "not base64!",
    Buffer.alloc(15, 1).toString("base64"),
    Buffer.alloc(17, 1).toString("base64"),
    " " + KEY.slice(1),
  ];
  for (const key of bad) {
    const outcome = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-key": key }));
    assert.equal(outcome.accepted, false, `key ${JSON.stringify(key)} must be refused`);
    assert.equal(outcome.status, 400);
  }
  // Surrounding whitespace is header framing, not part of the key.
  const padded = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-key": " " + KEY + " " }));
  assert.equal(padded.accepted, true);
});

suite("subprotocol selection follows the server's preference", () => {
  const both = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-protocol": "a, b" }), {
    protocols: ["b", "a"],
  });
  assert.equal(both.protocol, "b", "the server's order decides, not the client's");
  assert.equal(headerValue(both, "sec-websocket-protocol"), "b");

  const none = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-protocol": "x, y" }), {
    protocols: ["a"],
  });
  assert.equal(none.accepted, true, "no common subprotocol is not a failed handshake");
  assert.equal(none.protocol, null);
  assert.equal(headerValue(none, "sec-websocket-protocol"), null);

  // A server that declares none selects none even when the client offers.
  const declared = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-protocol": "a" }));
  assert.equal(declared.protocol, null);
});

suite("our own client completes the handshake this server produces", async (t) => {
  let seenProtocol = null;
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let head = "";
    const readHead = (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      socket.off("data", readHead);
      const [requestLine, ...lines] = head.slice(0, head.indexOf("\r\n\r\n")).split("\r\n");
      const method = requestLine.split(" ")[0];
      const headers = lines.map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
      });
      const outcome = acceptWebSocketUpgrade(method, headers, { protocols: ["chat"] });
      seenProtocol = outcome.accepted ? outcome.protocol : null;
      socket.write(serializeUpgradeResponse(outcome));
      if (!outcome.accepted) {
        socket.end();
        return;
      }
      // A minimal echo, framed by hand: the point is that a real client accepted the
      // handshake and then spoke to us, not that this is a finished server.
      socket.on("data", (frame) => {
        const masked = (frame[1] & 0x80) !== 0;
        const length = frame[1] & 0x7f;
        const maskStart = 2;
        const payloadStart = maskStart + (masked ? 4 : 0);
        const payload = Buffer.from(frame.subarray(payloadStart, payloadStart + length));
        if (masked) {
          for (let index = 0; index < payload.length; index++) {
            payload[index] ^= frame[maskStart + (index % 4)];
          }
        }
        socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
      });
    };
    socket.on("data", readHead);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;

  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat", "other"]);
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("the client rejected the handshake")));
  });
  const message = new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data));
  });
  await opened;
  assert.equal(socket.protocol, "chat", "the client sees the subprotocol the server chose");
  assert.equal(seenProtocol, "chat");
  socket.send("round trip");
  assert.equal(await message, "round trip");
  socket.close();
});
