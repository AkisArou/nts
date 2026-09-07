// A WebSocket server that listens, accepts and upgrades, end to end.
//
// This closes the largest row that was open in the plan. The handshake, the server-side
// session and the connection lifetime owner all existed; what did not was a way to get a
// connection in the first place, because the provider ABI had `connect` and no `listen`.
//
// Both peer lanes weighed in on that interface before it was written. The JVM lane
// measured `bind`, port 0 and `accept` on an API-26 device; the Node lane, which has
// written this adapter, corrected the backlog contract, the close semantics and the
// bound-address field. Every one of those decisions has a test here.
import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";

import { AbortController } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import {
  serveWebSocketUpgrades,
  WebSocketServer,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import {
  HostNodeScheduler,
  HostNodeSocketBinder,
  hostNodeRandom,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const none = () => new AbortController().signal;

function serverOf(t, options = {}) {
  const scheduler = new HostNodeScheduler(() => {});
  const server = new WebSocketServer({
    random: hostNodeRandom,
    scheduler,
    protocols: ["chat"],
    ...options,
  });
  t.after(() => server.close());
  return server;
}

async function listening(t, options = {}) {
  const listener = await new HostNodeSocketBinder().listen(
    { hostname: "127.0.0.1", port: 0, ...options },
    none(),
  );
  t.after(() => listener.close());
  return listener;
}

suite("port zero is answered with the port that was bound", async (t) => {
  const listener = await listening(t);
  assert.equal(typeof listener.address.port, "number");
  assert.ok(listener.address.port > 0, "a real port, not the zero that was asked for");
  assert.equal(listener.address.hostname, "127.0.0.1");
});

suite("the bound address is the literal one, not the name that was asked for", async (t) => {
  // Asking for "127.0.0.1" cannot distinguish the two, because the request and the
  // literal are the same string. `localhost` can: it resolves to one family or the
  // other, and a caller that echoes the name back can reach the wrong one.
  const listener = await listening(t, { hostname: "localhost" });
  assert.notEqual(listener.address.hostname, "localhost");
  assert.match(listener.address.hostname, /^(127\.0\.0\.1|::1)$/);
});

suite("a bind failure rejects the listen rather than escaping as an event", async (t) => {
  const first = await listening(t);
  // Node reports this on `'error'` a tick after `listen()` returns. Wired to the call
  // instead, a taken port becomes an unhandled event on the server.
  await assert.rejects(
    () =>
      new HostNodeSocketBinder().listen(
        { hostname: "127.0.0.1", port: first.address.port },
        none(),
      ),
    (error) => String(error?.code ?? "") === "EADDRINUSE",
  );
});

suite("closing the listener resolves a waiting accept with null", async (t) => {
  const listener = await listening(t);
  const pending = listener.accept(none());
  listener.close();
  // A closed listener is a normal ending, so the obvious loop terminates rather than
  // needing a try/catch around every shutdown.
  assert.equal(await pending, null);
  assert.equal(await listener.accept(none()), null);
});

suite("aborting one accept rejects it and leaves the listener open", async (t) => {
  const listener = await listening(t);
  const controller = new AbortController();
  const reason = new Error("this caller changed its mind");
  const abandoned = listener.accept(controller.signal);
  controller.abort(reason);
  await assert.rejects(() => abandoned, (thrown) => thrown === reason);

  // The listener is still live: a second accept succeeds against a real connection.
  const accepted = listener.accept(none());
  const client = connect(listener.address.port, "127.0.0.1");
  t.after(() => client.destroy());
  const connection = await accepted;
  assert.notEqual(connection, null);
  connection.close();
});

suite("an already-aborted signal never reaches the accept", async (t) => {
  const listener = await listening(t);
  const controller = new AbortController();
  const reason = new Error("too late");
  controller.abort(reason);
  await assert.rejects(
    () => listener.accept(controller.signal),
    (thrown) => thrown === reason,
  );
});

suite("an aborted signal rejects even on a listener that is already closed", async (t) => {
  // This is the only case where checking the signal up front differs from relying on
  // the subscription: a closed listener answers `null`, and abort has to win, because
  // abort is about this call rather than about the listener.
  const listener = await listening(t);
  listener.close();
  const controller = new AbortController();
  const reason = new Error("aborted after close");
  controller.abort(reason);
  await assert.rejects(
    () => listener.accept(controller.signal),
    (thrown) => thrown === reason,
  );
});

suite("the loop serves a real WebSocket client over a real socket", async (t) => {
  const listener = await listening(t);
  const server = serverOf(t);
  const controller = new AbortController();
  const sessions = [];
  const errors = [];

  const loop = serveWebSocketUpgrades(listener, server, controller.signal, {
    onSession: (result, head) => {
      if (result.accepted) sessions.push({ session: result.session, target: head.target });
    },
    onError: (error) => errors.push(error),
  });
  t.after(async () => {
    controller.abort();
    listener.close();
    await loop;
  });

  // Drive the canonical client against it.
  const { createHostNodeWebPlatform } = await import(
    "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js"
  );
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  const socket = api.createWebSocket(`ws://127.0.0.1:${listener.address.port}/`, ["chat"]);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("handshake refused")));
  });
  assert.equal(socket.protocol, "chat");
  assert.equal(server.connections, 1, "the server counted the session it owns");

  assert.equal(sessions.length, 1, "the loop handed the session to its caller");
  assert.equal(sessions[0].target, "/", "with the request head that produced it");

  const echoed = new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data));
  });
  socket.send("through the accept loop");

  // The server side of the session is the embedder's to drive.
  const incoming = await sessions[0].session.next();
  assert.equal(incoming.kind, "text");
  assert.equal(incoming.data, "through the accept loop");
  await sessions[0].session.send(incoming);
  assert.equal(await echoed, "through the accept loop");

  socket.close(1000, "done");
  assert.deepEqual(errors, []);
});

suite("a connection that is not an upgrade is refused without stopping the loop", async (t) => {
  const listener = await listening(t);
  const server = serverOf(t);
  const controller = new AbortController();
  const errors = [];
  const loop = serveWebSocketUpgrades(listener, server, controller.signal, {
    onError: (error) => errors.push(error),
  });
  t.after(async () => {
    controller.abort();
    listener.close();
    await loop;
  });

  // Plain HTTP, no upgrade headers: refused with a status, and the loop carries on.
  const CRLF = String.fromCharCode(13, 10);
  const plain = connect(listener.address.port, "127.0.0.1", () => {
    plain.write(`GET / HTTP/1.1${CRLF}Host: x${CRLF}${CRLF}`);
  });
  t.after(() => plain.destroy());
  const status = await new Promise((resolve) => {
    let text = "";
    plain.on("data", (chunk) => {
      text += chunk.toString("latin1");
      if (text.includes(CRLF)) resolve(text.split(CRLF)[0]);
    });
    plain.on("error", () => resolve("error"));
  });
  assert.match(status, /^HTTP\/1\.1 (400|426)/, `refused with a status, got ${status}`);

  // And a connection that cannot even be parsed, which is the case that actually
  // reaches the loop's error path: a status refusal is a normal return, not a throw.
  const garbage = connect(listener.address.port, "127.0.0.1", () => {
    garbage.write(`not a request line at all${CRLF}${CRLF}`);
  });
  t.after(() => garbage.destroy());
  await new Promise((resolve) => {
    garbage.on("close", resolve);
    garbage.on("error", resolve);
    setTimeout(resolve, 300);
  });
  assert.ok(errors.length >= 1, "the malformed connection was reported");

  // And the loop is still serving: a real client connects afterwards.
  const { createHostNodeWebPlatform } = await import(
    "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js"
  );
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  const socket = api.createWebSocket(`ws://127.0.0.1:${listener.address.port}/`, ["chat"]);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("the loop stopped serving")));
  });
  socket.close(1000, "done");
});
