// Unedited Fetch data-type WPT with canonical package globals and no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  AbortController, AbortSignal, Blob, ByteLengthQueuingStrategy,
  CountQueuingStrategy, DOMException, File, FormData, Headers,
  ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest, ReadableStreamDefaultController,
  ReadableStreamDefaultReader, Request, Response, TextDecoder,
  TextDecoderStream, TextEncoder, TextEncoderStream, TransformStream,
  TransformStreamDefaultController, URLSearchParams, WritableStream,
  WritableStreamDefaultController, WritableStreamDefaultWriter,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("fetch-manifest.json", root), "utf8")) as WptManifest;
const prefix = process.env.NTS_WPT_FETCH_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length > 0, "The Fetch fixture filter must select at least one file");

test("WPT Fetch data types — pinned local-only cases", async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    let transportAttempts = 0;
    const runtime = createHostNodeWebPlatform({
      baseURL: "https://web-platform.test/",
      origin: "https://web-platform.test",
      fetchTransport: {
        async dispatch() {
          transportAttempts++;
          throw new Error("The Fetch data-type WPT selection must not access the network");
        },
      },
    }, {}, reportError);
    return {
      exposeSelf: true,
      globals: {
        AbortController, AbortSignal, Blob, ByteLengthQueuingStrategy,
        CountQueuingStrategy, DOMException, File, FormData, Headers,
        ReadableByteStreamController, ReadableStream, ReadableStreamBYOBReader,
        ReadableStreamBYOBRequest, ReadableStreamDefaultController,
        ReadableStreamDefaultReader, Request, Response, TextDecoder,
        TextDecoderStream, TextEncoder, TextEncoderStream, TransformStream,
        TransformStreamDefaultController, URLSearchParams, WritableStream,
        WritableStreamDefaultController, WritableStreamDefaultWriter,
        // Scheme-local data: fetches use the package implementation. The transport
        // guard makes even an unexpected, caught outbound request fail the file.
        fetch: runtime.fetch,
        // Genuine ECMAScript intrinsics align ordinary host buffer/promise checks.
        // Realm-identity cases have explicit exclusions, not relaxed assertions.
        Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
        BigInt64Array, BigUint64Array,
      },
      async close() {
        await runtime.close();
        assert.equal(transportAttempts, 0, "An unclassified WPT case attempted an outbound Fetch");
      },
    };
  });
});
