// Which Request fields change what happens, and which are deliberately inert.
//
// The plan keeps browser-oriented fields observable even where their enforcement
// algorithm is excluded from this profile: there is no document, so there is no unload
// for `keepalive` to survive, no CORS for `mode` to select, and no document origin for
// `referrerPolicy` to derive from. Being inert is the correct behaviour for those.
//
// It is also indistinguishable, from outside, from a field that should do something and
// does not -- which is exactly what `integrity` was until this session. So the split is
// asserted rather than assumed, and adding a field to the wrong side fails here.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";

import {
  AbortController,
  ReadableStream,
  Request,
  Response,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const CRLF = String.fromCharCode(13, 10);

/** Records every request head it is sent and answers each with a fixed response. */
async function recordingServer(t) {
  const heads = [];
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("latin1");
      const end = buffered.indexOf(CRLF + CRLF);
      if (end < 0) return;
      heads.push(buffered.slice(0, end));
      buffered = buffered.slice(end + 4);
      socket.write(
        "HTTP/1.1 200 OK" +
          CRLF +
          "content-length: 2" +
          CRLF +
          "connection: close" +
          CRLF +
          CRLF +
          "ok",
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { heads, port: server.address().port };
}

function runtimeFor(t) {
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  return api;
}

/**
 * Fields whose value is observable and deliberately changes nothing on the wire.
 *
 * Each entry is two values that differ, so "inert" is checked by comparing two real
 * requests rather than by asserting a default.
 */
const INERT_FIELDS = {
  mode: ["cors", "no-cors"],
  referrerPolicy: ["", "no-referrer"],
  keepalive: [false, true],
};

/**
 * Accepted in the init and deliberately *not* exposed on the Request.
 *
 * Fetch defines `RequestInit.priority` and no matching `Request.priority` attribute, so
 * a getter here would be an invention. It is still checked for inertness on the wire.
 */
const UNEXPOSED_FIELDS = {
  priority: ["auto", "high"],
};

suite("an inert field is readable, survives a clone, and reaches the Request", (t) => {
  runtimeFor(t);
  for (const [field, [, second]] of Object.entries(INERT_FIELDS)) {
    const request = new Request("https://example.test/", { [field]: second });
    assert.equal(request[field], second, `${field} must be readable`);
    assert.equal(request.clone()[field], second, `${field} must survive a clone`);
  }
  // And the unexposed ones stay unexposed: inventing a getter Fetch does not define
  // would be as wrong as omitting one it does.
  for (const field of Object.keys(UNEXPOSED_FIELDS)) {
    const request = new Request("https://example.test/", { [field]: "high" });
    assert.equal(request[field], undefined, `${field} is not a Request attribute`);
  }
});

suite("two requests differing only in an inert field produce identical bytes", async (t) => {
  const { heads, port } = await recordingServer(t);
  const api = runtimeFor(t);
  const url = `http://127.0.0.1:${port}/path`;

  const wireInert = { ...INERT_FIELDS, ...UNEXPOSED_FIELDS };
  for (const [field, [first, second]] of Object.entries(wireInert)) {
    heads.length = 0;
    await (await api.fetch(url, { [field]: first })).text();
    await (await api.fetch(url, { [field]: second })).text();
    assert.equal(heads.length, 2, `${field}: both requests must have reached the server`);
    // The decisive assertion. If a field ever starts affecting the wire, this is where
    // it shows up, and the entry has to move to the enforced side deliberately.
    assert.equal(heads[0], heads[1], `${field} must not change the request on the wire`);
  }
});

suite("the enforced fields do change what happens", async (t) => {
  const { heads, port } = await recordingServer(t);
  const api = runtimeFor(t);
  const url = `http://127.0.0.1:${port}/path`;

  // method and headers reach the wire.
  heads.length = 0;
  await (await api.fetch(url, { method: "HEAD", headers: { "x-marker": "here" } })).text();
  assert.match(heads[0], /^HEAD \/path HTTP\/1\.1/);
  assert.match(heads[0], /x-marker: here/);

  // redirect: "error" is a policy, not metadata.
  await assert.rejects(api.fetch(url, { redirect: "nonsense" }), TypeError);

  // duplex is enforced at construction: a streaming body without it is refused.
  const stream = new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
  assert.throws(() => new Request(url, { method: "POST", body: stream }), TypeError);

  // signal aborts a real request rather than being recorded.
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.fetch(url, { signal: controller.signal }));

  // integrity is enforced, and its enforcement is what this test exists to contrast
  // with the inert fields: an unverifiable requirement stops the request.
  //
  // It stops it with a *descriptive* TypeError rather than an opaque network error,
  // because this environment has no digest provider and that is a configuration
  // mistake rather than a network outcome. A digest that is computed and does not
  // match is the opposite: that is a network error, opaque as Fetch requires, and is
  // asserted in the integrity suite.
  await assert.rejects(
    api.fetch(url, { integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }),
    (error) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /cannot verify it/);
      return true;
    },
  );
});

suite("an inert field survives a Cache round trip", async (t) => {
  const api = runtimeFor(t);
  const cache = await api.caches.open("fields");
  const request = new Request("https://example.test/kept", {
    mode: "no-cors",
    referrerPolicy: "no-referrer",
    keepalive: true,
  });
  await cache.put(request, new Response("stored"));
  const [restored] = await cache.keys();
  // Observable metadata that did not survive storage would be observable only until it
  // mattered, which is worse than not having it.
  assert.equal(restored.mode, "no-cors");
  assert.equal(restored.referrerPolicy, "no-referrer");
  assert.equal(restored.keepalive, true);
});
