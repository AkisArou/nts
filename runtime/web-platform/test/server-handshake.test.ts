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
import type { TestContext } from "node:test";
import { createServer } from "node:net";
import { createHash } from "node:crypto";

import {
  acceptWebSocketUpgrade,
  serializeUpgradeResponse,
} from "../src/provider.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import type { Socket } from "node:net";
import { messageData, must, portOf } from "./harness.ts";
import type { HeaderEntry } from "../src/fetch/headers.ts";
import type {
  WebSocketUpgradeAccepted,
  WebSocketUpgradeOutcome,
} from "../src/websocket/server-handshake.ts";
import type { Event } from "../src/index.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
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

/**
 * An accepted upgrade, narrowed.
 *
 * `WebSocketUpgradeOutcome` is a union: only the accepted arm carries `protocol`. Reading it off
 * the union was possible only because nothing checked, and asserting the arm is a stronger
 * statement than the property read was.
 */
function accepted(outcome: WebSocketUpgradeOutcome): WebSocketUpgradeAccepted {
  assert.ok(outcome.accepted, `expected an accepted upgrade, got status ${outcome.status}`);
  return outcome;
}

function headerValue(outcome: WebSocketUpgradeOutcome, name: string): string | null {
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
  assert.equal(accepted(both).protocol, "b", "the server's order decides, not the client's");
  assert.equal(headerValue(both, "sec-websocket-protocol"), "b");

  const none = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-protocol": "x, y" }), {
    protocols: ["a"],
  });
  assert.equal(none.accepted, true, "no common subprotocol is not a failed handshake");
  assert.equal(accepted(none).protocol, null);
  assert.equal(headerValue(none, "sec-websocket-protocol"), null);

  // A server that declares none selects none even when the client offers.
  const declared = acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-protocol": "a" }));
  assert.equal(accepted(declared).protocol, null);
});

suite("our own client completes the handshake this server produces", async (t) => {
  let seenProtocol = null;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let head = "";
    const readHead = (chunk: Buffer): void => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      socket.off("data", readHead);
      const [requestLine, ...lines] = head.slice(0, head.indexOf("\r\n\r\n")).split("\r\n");
      const method = must(requestLine, "the client sent a request line").split(" ")[0];
      const headers: HeaderEntry[] = lines.map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
      });
      const outcome = acceptWebSocketUpgrade(
        must(method, "a request line begins with a method"),
        headers,
        { protocols: ["chat"] },
      );
      seenProtocol = outcome.accepted ? outcome.protocol : null;
      socket.write(serializeUpgradeResponse(outcome));
      if (!outcome.accepted) {
        socket.end();
        return;
      }
      // A minimal echo, framed by hand: the point is that a real client accepted the
      // handshake and then spoke to us, not that this is a finished server.
      socket.on("data", (frame: Buffer) => {
        // A frame short enough to be missing its second byte is not one this hand-rolled echo
        // has to serve; reading it out once says so rather than each access assuming it.
        const second = frame[1];
        if (second === undefined) return;
        const masked = (second & 0x80) !== 0;
        const length = second & 0x7f;
        const maskStart = 2;
        const payloadStart = maskStart + (masked ? 4 : 0);
        const payload = Buffer.from(frame.subarray(payloadStart, payloadStart + length));
        if (masked) {
          for (let index = 0; index < payload.length; index++) {
            payload[index] = (payload[index] ?? 0) ^ (frame[maskStart + (index % 4)] ?? 0);
          }
        }
        socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
      });
    };
    socket.on("data", readHead);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const port = portOf(server);

  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat", "other"]);
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("the client rejected the handshake")));
  });
  const message = new Promise((resolve) => {
    socket.addEventListener("message", (event: Event) => resolve(messageData(event)));
  });
  await opened;
  assert.equal(socket.protocol, "chat", "the client sees the subprotocol the server chose");
  assert.equal(seenProtocol, "chat");
  socket.send("round trip");
  assert.equal(await message, "round trip");
  socket.close();
});

suite("compression is declined unless the server asks to negotiate it", () => {
  const offered = headersOf({ "sec-websocket-extensions": "permessage-deflate" });
  const off = acceptWebSocketUpgrade("GET", offered);
  assert.equal(accepted(off).perMessageDeflate, null);
  assert.equal(headerValue(off, "sec-websocket-extensions"), null);

  const on = acceptWebSocketUpgrade("GET", offered, { perMessageDeflate: true });
  assert.equal(headerValue(on, "sec-websocket-extensions"), "permessage-deflate");
  assert.deepEqual(accepted(on).perMessageDeflate, {
    response: "permessage-deflate",
    incomingNoContextTakeover: false,
    outgoingNoContextTakeover: false,
    incomingWindowBits: 15,
    outgoingWindowBits: 15,
  });

  // No offer at all is declined even when negotiation is enabled.
  const none = acceptWebSocketUpgrade("GET", headersOf(), { perMessageDeflate: true });
  assert.equal(accepted(none).perMessageDeflate, null);
});

suite("the negotiated parameters are the ones the server commits to", () => {
  const negotiate = (value: string): WebSocketUpgradeOutcome =>
    acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-extensions": value }), {
      perMessageDeflate: true,
    });

  // A requested no-context-takeover in either direction is honoured and echoed.
  const both = negotiate(
    "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
  );
  assert.equal(must(accepted(both).perMessageDeflate, "compression was negotiated").outgoingNoContextTakeover, true);
  assert.equal(must(accepted(both).perMessageDeflate, "compression was negotiated").incomingNoContextTakeover, true);
  assert.equal(
    must(accepted(both).perMessageDeflate, "compression was negotiated").response,
    "permessage-deflate; server_no_context_takeover; client_no_context_takeover",
  );

  // A window ceiling on the server's own traffic is adopted and echoed.
  const limited = negotiate("permessage-deflate; server_max_window_bits=10");
  assert.equal(must(accepted(limited).perMessageDeflate, "compression was negotiated").outgoingWindowBits, 10);
  assert.match(must(accepted(limited).perMessageDeflate, "compression was negotiated").response, /server_max_window_bits=10/);

  // A bare server_max_window_bits leaves the choice to the server, which keeps 15 and
  // therefore says nothing about it.
  const bare = negotiate("permessage-deflate; server_max_window_bits");
  assert.equal(must(accepted(bare).perMessageDeflate, "compression was negotiated").outgoingWindowBits, 15);
  assert.equal(must(accepted(bare).perMessageDeflate, "compression was negotiated").response, "permessage-deflate");

  // client_max_window_bits may be answered only because the client mentioned it.
  const client = negotiate("permessage-deflate; client_max_window_bits=9");
  assert.equal(must(accepted(client).perMessageDeflate, "compression was negotiated").incomingWindowBits, 9);
  assert.match(must(accepted(client).perMessageDeflate, "compression was negotiated").response, /client_max_window_bits=9/);
  // A bare client_max_window_bits states support without asking for a limit, so the
  // server does not impose one and must not name the parameter.
  const bareClient = negotiate("permessage-deflate; client_max_window_bits");
  assert.equal(must(accepted(bareClient).perMessageDeflate, "compression was negotiated").response, "permessage-deflate");
  // And a client that never mentioned it is never sent it.
  assert.equal(must(accepted(negotiate("permessage-deflate")).perMessageDeflate, "compression was negotiated").response, "permessage-deflate");
});

suite("an offer that cannot be honoured exactly is passed over", () => {
  const negotiate = (value: string): WebSocketUpgradeOutcome =>
    acceptWebSocketUpgrade("GET", headersOf({ "sec-websocket-extensions": value }), {
      perMessageDeflate: true,
    });

  for (const bad of [
    "permessage-deflate; unknown_parameter",
    "permessage-deflate; server_max_window_bits=7",
    "permessage-deflate; server_max_window_bits=16",
    "permessage-deflate; server_max_window_bits=x",
    "permessage-deflate; client_max_window_bits=0",
    "permessage-deflate; server_no_context_takeover=1",
    "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
  ]) {
    const outcome = negotiate(bad);
    assert.equal(outcome.accepted, true, "a bad extension offer is not a failed handshake");
    assert.equal(accepted(outcome).perMessageDeflate, null, `must not accept: ${bad}`);
  }

  // Several entries in preference order: the first honourable one wins.
  const fallback = negotiate("permessage-deflate; unknown_parameter, permessage-deflate");
  assert.equal(must(accepted(fallback).perMessageDeflate, "compression was negotiated").response, "permessage-deflate");
  // An unrelated extension is ignored rather than accepted.
  assert.equal(accepted(negotiate("some-other-extension")).perMessageDeflate, null);
});
