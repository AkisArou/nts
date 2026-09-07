// Surfaces where the standard requires *the same object*, not an equal one.
//
// Written on a suggestion from the Node lane, whose own version of this found three
// identities that node holds, that nothing upstream asserts, and that a compiled backend
// would lose while passing every test it has.
//
// The property these share is that the obvious repair preserves every observable value and
// breaks the identity: an accessor that builds its result on each read returns something
// indistinguishable by `deepEqual`, passes every test written in terms of contents, and
// silently breaks `signal === signal`, event listeners registered through one reference,
// and any `WeakMap` keyed on the object. Nothing else in this corpus would notice.
import assert from "node:assert/strict";
import test from "node:test";

import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
import {
  AbortController,
  Request,
  Response,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

function runtime(t) {
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  return api;
}

suite("a controller returns one signal, not one per read", (t) => {
  runtime(t);
  const controller = new AbortController();
  assert.equal(controller.signal, controller.signal);
  // The consequence, and the reason the identity is load-bearing: a listener registered
  // through one read must fire for an abort observed through another.
  let fired = 0;
  controller.signal.addEventListener("abort", () => fired++);
  controller.abort();
  assert.equal(fired, 1);
  assert.equal(controller.signal.aborted, true);
});

suite("an abort reason is the thrown object itself, not a copy of it", (t) => {
  runtime(t);
  const controller = new AbortController();
  const reason = new Error("stop");
  controller.abort(reason);
  assert.equal(controller.signal.reason, reason);
  // Twice, because an accessor that rebuilt its result would still pass the first read.
  assert.equal(controller.signal.reason, controller.signal.reason);
});

suite("a request returns one signal across reads", (t) => {
  runtime(t);
  const request = new Request("http://example.test/");
  assert.equal(request.signal, request.signal);
});

suite("a request built from a request keeps listening to the original abort", (t) => {
  runtime(t);
  const controller = new AbortController();
  const original = new Request("http://example.test/", { signal: controller.signal });
  const derived = new Request(original);
  // Not the same signal -- the standard makes a new one -- but the new one must follow.
  let fired = 0;
  derived.signal.addEventListener("abort", () => fired++);
  controller.abort();
  assert.equal(derived.signal.aborted, true, "the derived signal must follow the original");
  assert.equal(fired, 1);
});

suite("a body is one stream across reads, so locking it is observable", (t) => {
  runtime(t);
  const response = new Response("hello");
  assert.equal(response.body, response.body);
  // The identity is what makes disturbance work at all: a reader taken from one read must
  // lock the stream a second read returns.
  const reader = response.body.getReader();
  assert.equal(response.body.locked, true);
  reader.releaseLock();
});

suite("a null body is null on every read rather than an empty stream", (t) => {
  runtime(t);
  const response = new Response(null, { status: 204 });
  assert.equal(response.body, null);
  assert.equal(response.body, null);
});

suite("a clone gives a different stream, and the original keeps its own", async (t) => {
  runtime(t);
  const response = new Response("hello");
  const original = response.body;
  const clone = response.clone();
  // The negative of every case above: sharing the object here would mean one consumer
  // disturbs the other, which is precisely what clone exists to prevent.
  assert.notEqual(clone.body, original, "a clone must not share the original's stream");
  assert.equal(response.body, response.body, "the original still answers with one stream");
  assert.equal(await clone.text(), "hello");
  assert.equal(await response.text(), "hello");
});

suite("headers are one object across reads", (t) => {
  runtime(t);
  const response = new Response("x", { headers: { "x-a": "1" } });
  assert.equal(response.headers, response.headers);
  // Load-bearing for the same reason: a mutation through one read must be visible through
  // another, wherever the guard permits mutation at all.
  const request = new Request("http://example.test/");
  assert.equal(request.headers, request.headers);
  request.headers.set("x-b", "2");
  assert.equal(request.headers.get("x-b"), "2");
});
