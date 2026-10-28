// Unchanged EventSource WPT, using this package's public APIs and local resources.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hostNodeURLs } from "../host/node-primitives.ts";
import {
  AbortController, AbortSignal, CookieJar, DOMException, Event, EventSource,
  EventTarget, MessageEvent, ServerCookiePolicy, TextDecoder, TextEncoder,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptFixture, WptManifest } from "./wpt/runner.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";
import { startWptServer } from "./wpt/server/server.ts";
import { substitute } from "./wpt/server/substitutions.ts";

interface EventSourceFixture extends WptFixture {
  requiresDocumentTitleMetadata?: boolean;
}

interface EventSourceManifest extends WptManifest {
  fixtures: EventSourceFixture[];
}

const root = new URL("./wpt/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("eventsource-conformance/manifest.json", root), "utf8")) as EventSourceManifest;
const filter = process.env.NTS_WPT_EVENTSOURCE_FILTER;
const manifest: EventSourceManifest = filter === undefined ? original : {
  ...original,
  fixtures: original.fixtures.filter((fixture) => (fixture.path + (fixture.variant ?? "")).includes(filter)),
};
const titleOnlyFiles = new Set(original.fixtures
  .filter((fixture) => fixture.requiresDocumentTitleMetadata)
  .map((fixture) => fixture.path));

test("WPT EventSource — pinned ordinary-host corpus", { timeout: 3_600_000 }, async (suite) => {
  assert.ok(manifest.fixtures.length > 0, "the WPT selection must not be empty");
  if (filter !== undefined) suite.diagnostic("Explicit targeted WPT filter: " + filter);
  suite.diagnostic("Selected WPT file runs: " + manifest.fixtures.length);
  const server = await startWptServer();
  suite.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "the resource server recorded an unexpected failure");
  });
  await runWptFixtures(suite, root, manifest, (reportError, context) => {
    // Reconnect resources advance cookie-backed state. A fresh jar belongs to
    // each fixture; credential policy remains the package's existing policy.
    const jar = new CookieJar({ urls: hostNodeURLs, wallTimeMilliseconds: Date.now });
    const runtime = createWptRuntime(server, {
      baseURL: context.url.href,
      origin: context.url.origin,
      cookies: new ServerCookiePolicy(jar),
      http1: { connectTimeoutMs: 60_000, headersTimeoutMs: 60_000, bodyReadTimeoutMs: 120_000 },
    }, reportError);
    const globals: Record<string, unknown> = {
      AbortController, AbortSignal, DOMException, Event, EventSource, EventTarget,
      MessageEvent, TextDecoder, TextEncoder,
      URL, location: context.url, fetch: runtime.fetch,
      ArrayBuffer, DataView, Uint8Array,
    };
    if (titleOnlyFiles.has(context.fixture.path)) {
      assert.equal(typeof context.metadata.title, "string", "audited title-only fixture needs its original META title");
      // These eight audited files read only document.title to name tests. This
      // is source metadata, without a DOM, browsing context or lifecycle claim.
      globals.document = { title: context.metadata.title };
    }
    return {
      globals,
      globalAliases: ["self"],
      async close() {
        runtime.close();
        await new Promise<void>((resolve) => setImmediate(resolve));
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
