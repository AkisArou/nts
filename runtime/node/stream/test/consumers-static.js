"use strict";

// Applicable behavior retained from pinned upstream
// `parallel/test-stream-consumers.js`. The upstream file also asks Blob's
// Web-IDL boundary to coerce arbitrary object-mode chunks through their
// prototype/ToPrimitive machinery; that operation is outside the static
// profile and aborts the other promise assertions before they are observed.
const common = require("../common");
const assert = require("assert");
const { arrayBuffer, blob, buffer, bytes, json, text } = require("stream/consumers");
const { PassThrough, Readable } = require("stream");
const { TransformStream } = require("stream/web");

const expectedBuffer = Buffer.from("hellothere");
const expectedArrayBuffer = expectedBuffer.buffer.slice(
  expectedBuffer.byteOffset,
  expectedBuffer.byteOffset + expectedBuffer.byteLength,
);

function delayedPassThrough(first, second) {
  const stream = new PassThrough();
  stream.write(first);
  setTimeout(() => stream.end(second), 10);
  return stream;
}

async function classicConsumers() {
  const resultBlob = await blob(delayedPassThrough("hello", "there"));
  assert.strictEqual(resultBlob.size, 10);
  assert.deepStrictEqual(await resultBlob.arrayBuffer(), expectedArrayBuffer);

  const resultArrayBuffer = await arrayBuffer(delayedPassThrough("hello", "there"));
  assert.strictEqual(resultArrayBuffer.byteLength, 10);
  assert.deepStrictEqual(resultArrayBuffer, expectedArrayBuffer);

  const resultBuffer = await buffer(delayedPassThrough("hello", "there"));
  assert.strictEqual(resultBuffer.byteLength, 10);
  assert.deepStrictEqual(resultBuffer.buffer, expectedArrayBuffer);

  const resultBytes = await bytes(delayedPassThrough("hello", "there"));
  assert.strictEqual(resultBytes.byteLength, 10);
  assert.deepStrictEqual(Buffer.from(resultBytes), expectedBuffer);

  assert.strictEqual(await text(delayedPassThrough("hello", "there")), "hellothere");
  assert.strictEqual(await json(delayedPassThrough('"hello', 'there"')), "hellothere");
}

async function malformedUtf8() {
  const readable = new Readable({ read() {} });
  const result = text(readable);
  readable.push(new Uint8Array([0x66, 0x6f, 0x6f, 0xed, 0xa0, 0x80]));
  readable.push(null);
  assert.strictEqual(await result, "foo\ufffd\ufffd\ufffd");
}

async function webConsumer(consume, quoted = false) {
  const { writable, readable } = new TransformStream();
  const result = consume(readable);
  await assert.rejects(consume(readable), { code: "ERR_INVALID_STATE" });

  const writer = writable.getWriter();
  await writer.write(quoted ? '"hello' : "hello");
  await writer.write(quoted ? 'there"' : "there");
  await writer.close();
  return result;
}

async function webConsumers() {
  const resultBlob = await webConsumer(blob);
  assert.strictEqual(resultBlob.size, 10);
  assert.deepStrictEqual(await resultBlob.arrayBuffer(), expectedArrayBuffer);

  const resultArrayBuffer = await webConsumer(arrayBuffer);
  assert.deepStrictEqual(resultArrayBuffer, expectedArrayBuffer);
  assert.strictEqual(await webConsumer(text), "hellothere");
  assert.strictEqual(await webConsumer(json, true), "hellothere");
}

async function objectModeTextRejects() {
  for (const consume of [text, json]) {
    const stream = new PassThrough({
      readableObjectMode: true,
      writableObjectMode: true,
    });
    const rejected = assert.rejects(consume(stream), {
      code: "ERR_INVALID_ARG_TYPE",
    });
    stream.write({});
    stream.end({});
    await rejected;
  }
}

async function incompleteUtf8Flushes() {
  const { writable, readable } = new TransformStream();
  const result = text(readable);
  const writer = writable.getWriter();
  await writer.write(new Uint8Array([0xe2]));
  await writer.write(new Uint8Array([0x82]));
  await writer.close();
  assert.strictEqual((await result).charCodeAt(0), 0xfffd);
}

Promise.all([
  classicConsumers(),
  malformedUtf8(),
  webConsumers(),
  objectModeTextRejects(),
  incompleteUtf8Flushes(),
]).then(common.mustCall());
