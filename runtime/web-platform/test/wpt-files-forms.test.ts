// Unedited FileAPI, FormData and URL-encoded WPT with canonical package APIs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  Blob, DOMException, Event, EventTarget, File, FormData, ReadableStream,
  Request, Response, TextDecoder, TextEncoder, URLSearchParams,
} from "../src/index.ts";
import { ProgressEvent } from "../src/core/progress-event.ts";
import { FileReader } from "../src/file/file-reader.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("file-forms-manifest.json", root), "utf8")) as WptManifest;
const prefix = process.env.NTS_WPT_FILES_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length > 0, "The Files/FormData fixture filter must select at least one file");
assert.equal(typeof globalThis.gc, "function", "Run FileAPI WPT with --expose-gc");

test("WPT FileAPI, FormData and URL-encoded parsing — pinned local-only cases", async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    let transportAttempts = 0;
    const runtime = createHostNodeWebPlatform({
      baseURL: "https://web-platform.test/",
      origin: "https://web-platform.test",
      fetchTransport: {
        async dispatch() {
          transportAttempts++;
          throw new Error("The Files/FormData WPT selection must not access the network");
        },
      },
    }, {}, reportError);
    return {
      exposeSelf: true,
      globals: {
        Blob, DOMException, Event, EventTarget, File, FileReader, FormData,
        ProgressEvent, ReadableStream, Request, Response, TextDecoder,
        TextEncoder, URLSearchParams,
        // Genuine host ECMAScript constructors keep ordinary buffer identity
        // checks aligned with the imported canonical implementation.
        Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
        BigInt64Array, BigUint64Array,
        // Pinned common/gc.js explicitly supports exposed V8 gc. This establishes
        // host behavior only, not nts memory-management conformance.
        gc: globalThis.gc,
      },
      async close() {
        await runtime.close();
        assert.equal(transportAttempts, 0, "An unclassified Files/FormData WPT case attempted an outbound Fetch");
      },
    };
  });
});
