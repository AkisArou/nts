// Source-policy controls beyond the unedited File API and FormData WPT fixtures.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Blob, File, _createBlobFromExternalSource } from "../src/file/blob.ts";
import * as blobInternals from "../src/file/blob.ts";
import type { BlobExternalSource } from "../src/file/blob.ts";
import type { ReadableStream } from "../src/streams/readable.ts";

function useRuntime(t: TestContext): void {
  const runtime = createHostNodeWebPlatform();
  t.after(() => runtime.close());
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const reader = stream.getReader();
  const bytes: number[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) return bytes;
    for (const byte of result.value) bytes.push(byte);
  }
}

// https://w3c.github.io/FileAPI/#readOperation
// FileReader needs interface identity and the Blob's own storage, not public
// methods that a subclass can override. These helpers are not public Web APIs.
test("internal Blob access recognizes Blob and File and reads their metadata", (t) => {
  useRuntime(t);
  assert.equal(typeof blobInternals.isBlob, "function");
  assert.equal(typeof blobInternals.getBlobSize, "function");
  assert.equal(typeof blobInternals.getBlobType, "function");
  const blob = new Blob(["abc"], { type: "TEXT/PLAIN" });
  const file = new File([blob, "d"], "name", { type: "TEXT/CUSTOM", lastModified: 0 });
  for (const value of [null, undefined, {}, "blob", new Uint8Array(0)]) {
    assert.equal(blobInternals.isBlob(value), false);
  }
  assert.equal(blobInternals.isBlob(blob), true);
  assert.equal(blobInternals.isBlob(file), true);
  assert.equal(blobInternals.getBlobSize(blob), 3);
  assert.equal(blobInternals.getBlobType(blob), "text/plain");
  assert.equal(blobInternals.getBlobSize(file), 4);
  assert.equal(blobInternals.getBlobType(file), "text/custom");
});

test("internal Blob streams read independent immutable bytes without public method dispatch", async (t) => {
  useRuntime(t);
  assert.equal(typeof blobInternals.getBlobStream, "function");
  let calls = 0;
  class DerivedBlob extends Blob {
    override stream(): never { calls++; throw new Error("public stream must not be called"); }
    override bytes(): never { calls++; throw new Error("public bytes must not be called"); }
    override arrayBuffer(): never { calls++; throw new Error("public arrayBuffer must not be called"); }
  }
  const input = new Uint8Array([1, 2, 3]);
  const blob = new DerivedBlob([input]);
  input.fill(9);
  const first = blobInternals.getBlobStream(blob);
  const second = blobInternals.getBlobStream(blob);
  assert.notEqual(first, second);
  assert.deepEqual(await readAll(first), [1, 2, 3]);
  assert.deepEqual(await readAll(second), [1, 2, 3]);
  assert.equal(calls, 0);
});

test("internal Blob streams preserve external-reader cancellation and reopening", async (t) => {
  useRuntime(t);
  assert.equal(typeof blobInternals.getBlobStream, "function");
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const calls: string[] = [];
  const source: BlobExternalSource = {
    size: bytes.length,
    open(start, length) {
      calls.push("open");
      let position = start;
      return {
        async read(maximumBytes) {
          calls.push("read");
          const end = Math.min(position + Math.min(maximumBytes, 2), start + length);
          if (end === position) return undefined;
          const chunk = bytes.slice(position, end);
          position = end;
          return chunk;
        },
        async close() { calls.push("close"); },
      };
    },
  };
  const blob = _createBlobFromExternalSource(source, "application/octet-stream");
  const reader = blobInternals.getBlobStream(blob).getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2]));
  await reader.cancel("stop");
  assert.deepEqual(calls, ["open", "read", "close"]);
  calls.length = 0;
  assert.deepEqual(await readAll(blobInternals.getBlobStream(blob)), [1, 2, 3, 4]);
  assert.deepEqual(calls, ["open", "read", "read", "close"]);
});
