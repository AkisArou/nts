// Source-policy controls beyond the unedited File API and FormData WPT fixtures.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Blob, File, _createBlobFromExternalSource } from "../src/file/blob.ts";
import * as blobInternals from "../src/file/blob.ts";
import type { BlobExternalSource, BlobOptions, BlobPart } from "../src/file/blob.ts";
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

// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
// https://w3c.github.io/FileAPI/#constructorBlob
for (const factory of [
  { name: "Blob", create: (parts: Iterable<BlobPart>, options: BlobOptions): Blob => new Blob(parts, options) },
  { name: "File", create: (parts: Iterable<BlobPart>, options: BlobOptions): Blob => new File(parts, "file", options) },
]) {
  test(`${factory.name} preserves a part conversion error without closing the iterator or reading options`, (t) => {
    useRuntime(t);
    const marker = new Error("part conversion");
    let closed = false;
    let optionReads = 0;
    function* parts(): Generator<unknown> {
      try {
        yield { toString(): never { throw marker; } };
      } finally {
        closed = true;
      }
    }
    assert.throws(() => factory.create(parts() as unknown as Iterable<BlobPart>, {
      get endings(): "transparent" { optionReads++; return "transparent"; },
    }), (error) => error === marker);
    assert.equal(closed, false);
    assert.equal(optionReads, 0);
  });

  test(`${factory.name} caches iterator methods and converts parts before options`, async (t) => {
    useRuntime(t);
    const order: string[] = [];
    let nextReads = 0;
    let index = 0;
    let methodReceiver: unknown;
    let nextReceiver: unknown;
    const next = function (this: unknown): IteratorResult<unknown> {
      nextReceiver = this;
      order.push("next");
      return index++ === 0
        ? { done: false, value: { toString(): string { order.push("part"); return "abc"; } } }
        : { done: true, value: undefined };
    };
    const iterator = { get next(): typeof next { nextReads++; return next; } };
    const method = function (this: unknown): typeof iterator { methodReceiver = this; return iterator; };
    const parts = { get [Symbol.iterator](): typeof method { order.push("iterator"); return method; } };
    const blob = factory.create(parts as unknown as Iterable<BlobPart>, {
      get endings(): "transparent" { order.push("endings"); return "transparent"; },
      get type(): string { order.push("type"); return "TEXT/PLAIN"; },
    });
    assert.deepEqual(order, ["iterator", "next", "part", "next", "endings", "type"]);
    assert.equal(nextReads, 1);
    assert.equal(methodReceiver, parts);
    assert.equal(nextReceiver, iterator);
    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), "abc");
  });
}

// https://webidl.spec.whatwg.org/#es-operations
// An exception in a promise-returning operation becomes a rejected promise.
for (const operation of ["bytes", "text", "arrayBuffer"] as const) {
  test(`Blob.${operation} rejects an incompatible receiver without throwing synchronously`, async (t) => {
    useRuntime(t);
    const blob = new Blob(["abc"]);
    const read: (this: unknown) => Promise<unknown> = blob[operation];
    let result: Promise<unknown> | undefined;
    assert.doesNotThrow(() => { result = read.call({}); });
    assert.ok(result instanceof Promise);
    await assert.rejects(result, TypeError);
    assert.equal(await blob.text(), "abc");
  });
}

// https://w3c.github.io/FileAPI/#dom-blob-arraybuffer
for (const factory of [
  { name: "Blob", create: (): Blob => new Blob([new Uint8Array([1, 2, 3])]) },
  { name: "File", create: (): Blob => new File([new Uint8Array([1, 2, 3])], "file") },
]) {
  test(`${factory.name}.arrayBuffer reads private storage despite an overridden bytes method`, async (t) => {
    useRuntime(t);
    const blob = factory.create();
    let calls = 0;
    blob.bytes = (): never => { calls++; throw new Error("public bytes must not be called"); };
    const first = await blob.arrayBuffer();
    assert.deepEqual(new Uint8Array(first), new Uint8Array([1, 2, 3]));
    new Uint8Array(first).fill(9);
    const second = await blob.arrayBuffer();
    assert.notEqual(first, second);
    assert.deepEqual(new Uint8Array(second), new Uint8Array([1, 2, 3]));
    assert.equal(calls, 0);
  });
}

for (const name of ["Blob iterator method.call spoofing", "Blob iterator next.call spoofing", "File iterator method.call spoofing", "File iterator next.call spoofing"]) {
  test(name, { skip: "typed nts programs cannot attach an own call property to a function" }, () => {});
}
