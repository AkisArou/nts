// The provider capability of a canonical Web value is owned by its NTS environment.
// It is reached through an internal factory, never through a public constructor
// argument, so script cannot substitute the URL parser, body policy, transports or
// proxy policy that a Request, Response, WebSocket, WebSocketStream or EventSource
// uses. These are host-level conformance tests of the shared algorithm; they are not
// compiled-provider evidence.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import { createHostNodeWebPlatform } from "../node-runtime.ts";
import {
  EventSource,
  Request,
  Response,
  WebSocket,
  WebSocketStream,
} from "../../../../runtime/web-platform/src/index.ts";
import type { WebPlatformRuntime } from "../../../../runtime/web-platform/src/provider.ts";
import type { WebPlatformOptions } from "../../../../runtime/web-platform/src/provider.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A complete second runtime is the most plausible forgery: script that obtained one
// legitimate runtime must not be able to bind another value to it.
/** A runtime with counting transports, so a test can see which one was reached. */
interface CountingRuntime {
  connects: number;
  dispatches: number;
  api: WebPlatformRuntime;
}

/**
 * A constructor reached with a surplus argument its overloads do not admit.
 *
 * Every use below is a forgery attempt, and the attempt is the test: the third argument used to
 * be a context seam, so these calls assert that offering one now changes nothing. The arity is
 * the violation rather than any one argument's type -- `Request` takes one or two arguments
 * publicly and four to six internally, and three matches neither -- so it is the constructor
 * that is widened, once and by name, instead of a cast at every site. A reader sees a
 * deliberate violation rather than a silenced error.
 */
function withSurplus<T>(constructor: new (...args: never) => T): new (...args: unknown[]) => T {
  return constructor as unknown as new (...args: unknown[]) => T;
}

function makeRuntime(t: TestContext, options: WebPlatformOptions = {}): CountingRuntime {
  const record: CountingRuntime = {
    connects: 0,
    dispatches: 0,
    // Replaced immediately below; the transports it is built from close over `record`.
    api: undefined as unknown as WebPlatformRuntime,
  };
  const webSocketTransport = {
    connect() {
      record.connects += 1;
      return Promise.reject(new Error("this transport never completes a handshake"));
    },
  };
  const fetchTransport = {
    dispatch() {
      record.dispatches += 1;
      return Promise.reject(new Error("this transport never reaches a network"));
    },
  };
  record.api = createHostNodeWebPlatform(
    { ...options, webSocketTransport, fetchTransport },
    {},
    () => {},
  );
  t.after(() => record.api.close());
  return record;
}

suite("public Web constructors ignore a surplus capability argument", async (t) => {
  // The last runtime installed owns the environment; `other` is a live but unelected
  // runtime, exactly what a caller would try to smuggle in.
  const other = makeRuntime(t, {
    baseURL: "https://other.test/",
    bodyPolicy: { maxConsumeBytes: 4 },
  });
  const environment = makeRuntime(t, { baseURL: "https://environment.test/base/" });

  // Request: the third argument used to be the context seam.
  const request = new (withSurplus(Request))("relative", undefined, other.api.requestContext);
  assert.equal(request.url, "https://environment.test/base/relative");

  // Response: `other` would cap consumption at four bytes.
  const response = new (withSurplus(Response))("payload", {}, other.api.requestContext);
  assert.equal(await response.text(), "payload");

  // WebSocket and WebSocketStream: the environment's transport is the only one used.
  new (withSurplus(WebSocket))("ws://example.test/socket", [], other.api);
  new (withSurplus(WebSocketStream))("ws://example.test/socket", {}, other.api);
  await tick();
  assert.equal(environment.connects, 2, "the environment transport must carry both sockets");
  assert.equal(other.connects, 0, "a surplus argument must not select a transport");

  // EventSource has no context parameter at all.
  const source = new (withSurplus(EventSource))("feed", undefined, other.api);
  assert.equal(source.url, "https://environment.test/base/feed");
  source.close();
  await tick();
  assert.equal(other.dispatches, 0, "a surplus argument must not select a fetch transport");
});

suite("internal factories still deliver an explicit capability", async (t) => {
  const other = makeRuntime(t, {
    baseURL: "https://other.test/",
    bodyPolicy: { maxConsumeBytes: 4 },
  });
  const environment = makeRuntime(t, { baseURL: "https://environment.test/base/" });

  // Cache reaches the internal Request factory, so `other`'s base URL resolves here
  // even though `environment` owns the ambient runtime.
  const cache = await other.api.caches.open("confinement");
  await cache.put("relative", new Response("stored"));
  const [key] = await cache.keys();
  assert.ok(key !== undefined, "the cache kept the entry that was put in it");
  assert.equal(key.url, "https://other.test/relative");
  assert.equal(new Request("relative").url, "https://environment.test/base/relative");

  // Cache reaches the internal Response factory, so `other`'s four-byte consumption
  // limit governs the response it produced.
  const stored = await cache.match("relative");
  assert.ok(stored !== undefined, "the cache matched the entry it stored");
  await assert.rejects(stored.text(), (error: unknown) => error instanceof RangeError);
  assert.equal(await new Response("stored").text(), "stored");

  // The runtime's own factories bind the socket to that runtime's transport.
  other.api.createWebSocket("ws://example.test/socket");
  other.api.createWebSocketStream("ws://example.test/socket");
  await tick();
  assert.equal(other.connects, 2, "an internal factory must use its own transport");
  assert.equal(environment.connects, 0, "the ambient runtime must not be substituted");
});
