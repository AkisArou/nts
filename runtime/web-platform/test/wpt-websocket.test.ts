// Unchanged WebSocket WPT, with the package's public classes and local resources.
// Browser realms and policies are inventoried separately in the area manifest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  AbortController, AbortSignal, Blob, CloseEvent, CustomEvent, DOMException,
  Event, EventTarget, File, MessageEvent, TextDecoder, TextEncoder,
  URLSearchParams, WebSocket,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";
import { startWptServer } from "./wpt/server/server.ts";
import { substitute } from "./wpt/server/substitutions.ts";

interface InterfaceSnapshot {
  readonly target: object;
  readonly properties: Map<PropertyKey, PropertyDescriptor>;
}

// Each browser fixture ordinarily receives new interface objects. The VM shares
// the imported implementation classes, so restore their surface after fixtures
// that intentionally delete attributes or install setters on the prototypes.
function snapshotInterfaces(globals: Record<string, unknown>): InterfaceSnapshot[] {
  const targets = new Set<object>();
  for (const value of Object.values(globals)) {
    if (typeof value !== "function") continue;
    targets.add(value);
    const prototype: unknown = value.prototype;
    if (typeof prototype === "object" && prototype !== null) targets.add(prototype);
  }
  return [...targets].map((target) => ({
    target,
    properties: new Map(Reflect.ownKeys(target).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      assert.ok(descriptor);
      return [key, descriptor];
    })),
  }));
}

function restoreInterfaces(snapshots: readonly InterfaceSnapshot[]): void {
  for (const { target, properties } of snapshots) {
    for (const key of Reflect.ownKeys(target)) {
      if (!properties.has(key)) {
        assert.equal(Reflect.deleteProperty(target, key), true, "fixture leaked an interface member");
      }
    }
    for (const [key, descriptor] of properties) Object.defineProperty(target, key, descriptor);
  }
}

const root = new URL("./wpt/", import.meta.url);
const original = JSON.parse(readFileSync(new URL("websockets-conformance/manifest.json", root), "utf8")) as WptManifest;
const filter = process.env.NTS_WPT_WEBSOCKET_FILTER;
const manifest: WptManifest = filter === undefined ? original : {
  ...original,
  fixtures: original.fixtures.filter((fixture) => (fixture.path + (fixture.variant ?? "")).includes(filter)),
};

test("WPT WebSocket — pinned ordinary-host corpus", { timeout: 1_800_000 }, async (suite) => {
  assert.ok(manifest.fixtures.length > 0, "the WPT selection must not be empty");
  if (filter !== undefined) suite.diagnostic("Explicit targeted WPT filter: " + filter);
  suite.diagnostic("Selected WPT file/variant runs: " + manifest.fixtures.length);
  const server = await startWptServer();
  suite.after(async () => {
    await server.close();
    assert.deepEqual(server.errors, [], "the resource server recorded an unexpected failure");
  });
  await runWptFixtures(suite, root, manifest, (reportError, context) => {
    const runtime = createWptRuntime(server, {
      baseURL: context.url.href,
      origin: context.url.origin,
      websocket: { connectTimeoutMs: 60_000, handshakeTimeoutMs: 60_000, closeTimeoutMs: 60_000 },
    }, reportError);
    const globals: Record<string, unknown> = {
      AbortController, AbortSignal, Blob, CloseEvent, CustomEvent, DOMException,
      Event, EventTarget, File, MessageEvent, TextDecoder, TextEncoder,
      URLSearchParams, WebSocket,
      // URL is the existing ordinary-node URL capability used by the provider.
      // No Node WebSocket, EventSource, Blob or Event is supplied here.
      URL, location: context.url, performance,
      fetch: runtime.fetch,
      // The implementation and fixture use the same ECMAScript buffer realm.
      // Cross-realm exposure is outside this ordinary-host execution profile.
      ArrayBuffer, SharedArrayBuffer, DataView, Int8Array, Uint8Array, Uint8ClampedArray,
      Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array,
      Float64Array, BigInt64Array, BigUint64Array,
    };
    const snapshots = snapshotInterfaces(globals);
    return {
      globals,
      // window is only a global alias for three prototype-setter fixtures. No
      // Window interface, Document, navigation or browsing context is emulated.
      globalAliases: ["self", "window"],
      async close() {
        try {
          runtime.close();
          // Drain already-enqueued protocol cleanup tasks before the next VM.
          await new Promise<void>((resolve) => setImmediate(resolve));
        } finally {
          restoreInterfaces(snapshots);
        }
      },
    };
  }, {
    baseURL: (fixture) => (fixture.path.includes(".https.") ? server.httpsOrigin : server.httpOrigin) + "/",
    timeoutCategory: "network",
    timeouts: { default: 60_000, long: 120_000, network: 60_000, reconnect: 120_000 },
    transformScript(source) {
      return substitute(source, { host: "web-platform.test", ports: server.ports });
    },
  });
});
