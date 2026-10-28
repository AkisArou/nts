// The unchanged Encoding WPT corpus runs against this package's four classes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import {
  DOMException,
  ReadableStream,
  TextDecoder,
  TextDecoderStream,
  TextEncoder,
  TextEncoderStream,
  TransformStream,
  WritableStream,
} from "../src/index.ts";
import { runWptFixtures } from "./wpt/runner.ts";
import type { WptManifest } from "./wpt/runner.ts";

const root = new URL("./wpt/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("encoding-manifest.json", root), "utf8")) as WptManifest;
const prefix = process.env.NTS_WPT_ENCODING_FIXTURE;
const selected = prefix === undefined ? manifest : {
  ...manifest,
  fixtures: manifest.fixtures.filter((fixture) => fixture.path.startsWith(prefix)),
};
assert.ok(selected.fixtures.length > 0, "The Encoding fixture filter must select at least one file");

test("WPT Encoding — Node 24.20 directory revision", async (suite) => {
  await runWptFixtures(suite, root, selected, (reportError) => {
    const runtime = createHostNodeWebPlatform({}, {}, reportError);
    return {
      exposeSelf: true,
      globals: {
        DOMException, ReadableStream, TextDecoder, TextDecoderStream,
        TextEncoder, TextEncoderStream, TransformStream, WritableStream,
        // Genuine implementation-realm ECMAScript constructors make fixture
        // buffer brands match the imported classes. These are not host codecs.
        Object, Function, Promise, ArrayBuffer, SharedArrayBuffer, DataView,
        Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
        Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array,
        BigInt64Array, BigUint64Array,
        // The unchanged common/sab.js discovers the actual SharedArrayBuffer
        // constructor through WebAssembly.Memory. This is test input creation,
        // not a claim that the package supplies WebAssembly or shared memory.
        WebAssembly: (globalThis as unknown as { WebAssembly: unknown }).WebAssembly,
        // An empty query runs every subset-tests.js case in this one file.
        // No Window, Document, network, MessageChannel or host codec is exposed.
        location: { search: "" },
      },
      close: () => runtime.close(),
    };
  });
});
