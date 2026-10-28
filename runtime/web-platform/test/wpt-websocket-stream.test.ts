// Unchanged tentative WebSocketStream WPT, using this package's public APIs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  AbortController, AbortSignal, DOMException, ReadableStream, TextDecoder,
  TextEncoder, URLSearchParams, WebSocketError, WebSocketStream, WritableStream,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";
import { startWptServer } from "./wpt/server/server.ts";
import { substitute } from "./wpt/server/substitutions.ts";
import { createDrainableTransport } from "./wpt/websocket-stream-conformance/drainable-transport.ts";

const root = new URL("./wpt/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("websocket-stream-conformance/manifest.json", root), "utf8")) as WptManifest;
const filter = process.env.NTS_WPT_WEBSOCKET_STREAM_FILTER;
const manifest: WptManifest = filter === undefined ? original : {
  ...original,
  fixtures: original.fixtures.filter((fixture) => (fixture.path + (fixture.variant ?? "")).includes(filter)),
};

test("WPT WebSocketStream — pinned tentative ordinary-host corpus", { timeout: 1_800_000 }, async (suite) => {
  assert.ok(manifest.fixtures.length > 0, "the WPT selection must not be empty");
  assert.equal(typeof globalThis.gc, "function", "run this corpus with --expose-gc");
  if (filter !== undefined) suite.diagnostic("Explicit targeted WPT filter: " + filter);
  suite.diagnostic("Selected WPT file/variant runs: " + manifest.fixtures.length);
  const server = await startWptServer();
  suite.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "the resource server recorded an unexpected failure");
  });
  await runWptFixtures(suite, root, manifest, (reportError, context) => {
    const options = {
      baseURL: context.url.href,
      origin: context.url.origin,
      websocket: { connectTimeoutMs: 60_000, handshakeTimeoutMs: 60_000, closeTimeoutMs: 60_000 },
    };
    // The first runtime owns the real transport; the second exposes the package
    // APIs over that capability. Observe whole provider sends so fixture cleanup
    // does not reject the GC test's deliberately unawaited writes. Nothing wraps
    // WebSocketStream or handles the promises returned to the unchanged WPT.
    const transportOwner = createWptRuntime(server, options, reportError);
    const activity = createDrainableTransport(transportOwner.transport);
    const runtime = createWptRuntime(server, { ...options, webSocketTransport: activity.transport }, reportError);
    return {
      globals: {
        AbortController, AbortSignal, DOMException, ReadableStream, TextDecoder,
        TextEncoder, URLSearchParams, WebSocketError, WebSocketStream, WritableStream,
        URL, location: context.url, performance, fetch: runtime.fetch,
        // Share the implementation's buffer realm. Worker/realm exposure is not
        // established by this ordinary-host profile. GC is the actual host hook.
        ArrayBuffer, SharedArrayBuffer, DataView, Uint8Array, WebAssembly,
        gc: globalThis.gc,
      },
      globalAliases: ["self"],
      async close() {
        try {
          await activity.drain();
        } finally {
          runtime.close();
          transportOwner.close();
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      },
    };
  }, {
    baseURL: server.httpOrigin + "/",
    timeoutCategory: "network",
    timeouts: { default: 60_000, network: 60_000, long: 120_000, reconnect: 120_000 },
    transformScript(source) {
      return substitute(source, { host: "web-platform.test", ports: server.ports });
    },
  });
});
