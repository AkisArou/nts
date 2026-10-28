// Unedited Streams WPT, using this package's classes and ordinary-node provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  AbortController,
  AbortSignal,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  DOMException,
  ReadableByteStreamController,
  ReadableStream,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  ReadableStreamDefaultReader,
  TransformStream,
  TransformStreamDefaultController,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("streams-manifest.json", root), "utf8")) as WptManifest;
const prefix = process.env.NTS_WPT_STREAMS_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length > 0, "The Streams fixture filter must select at least one file");

test("WPT Streams — Node 24.20 directory revision", { timeout: 600000 }, async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    const runtime = createHostNodeWebPlatform({}, {}, reportError);
    return {
      exposeSelf: true,
      globals: {
        AbortController, AbortSignal, ByteLengthQueuingStrategy, CountQueuingStrategy,
        DOMException, ReadableByteStreamController, ReadableStream,
        ReadableStreamBYOBReader, ReadableStreamBYOBRequest, ReadableStreamDefaultController,
        ReadableStreamDefaultReader, TransformStream, TransformStreamDefaultController,
        WritableStream, WritableStreamDefaultController, WritableStreamDefaultWriter,
        // The imported implementation creates host-realm promises and buffers. Use
        // those same genuine ECMAScript constructors for fixture input and identity
        // checks; no Node Web API class is supplied. VM literal/async-generator realm
        // differences are listed as exact manifest blocks, never relaxed assertions.
        Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
        BigInt64Array, BigUint64Array,
        gc: globalThis.gc,
      },
      close: () => runtime.close(),
    };
  });
});
