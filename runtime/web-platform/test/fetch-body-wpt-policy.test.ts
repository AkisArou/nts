// Source-policy controls for Fetch cases not covered by the unchanged WPT files.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { ReadableStream, Request, Response } from "../src/index.ts";
import { BodyState } from "../src/fetch/body.ts";
import { LimitError } from "../src/core/errors.ts";

const runtime = createHostNodeWebPlatform();
after(() => runtime.close());

interface BodySurface {
  readonly bodyUsed: boolean;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  blob(): Promise<{ text(): Promise<string> }>;
  formData(): Promise<{ get(name: string): unknown }>;
}

// https://streams.spec.whatwg.org/#readablestreamdefaultreader-read-all-bytes
// A non-byte chunk invokes failure steps; it does not cancel the source.
for (const kind of ["Response", "Request"] as const) {
  test(`${kind} rejects a non-byte body chunk without canceling its source`, async () => {
    let cancellations = 0;
    let oracleCancellations = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue("invalid" as unknown as Uint8Array); },
      cancel() { cancellations++; },
    });
    const oracleStream = new globalThis.ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue("invalid" as unknown as Uint8Array); },
      cancel() { oracleCancellations++; },
    });
    const subject = kind === "Response" ? new Response(stream) : new Request("https://example.test/", {
      method: "POST", body: stream, duplex: "half",
    });
    const oracle = kind === "Response" ? new globalThis.Response(oracleStream) : new globalThis.Request("https://example.test/", {
      method: "POST", body: oracleStream, duplex: "half",
    });
    await assert.rejects(subject.text(), TypeError);
    await assert.rejects(oracle.text(), TypeError);
    assert.equal(oracleCancellations, 0);
    assert.equal(cancellations, oracleCancellations);
    assert.equal(subject.bodyUsed, oracle.bodyUsed);
    assert.equal(stream.locked, oracleStream.locked);
  });
}

test("the configured body consumption limit still cancels with its exact error", async () => {
  let cancellationReason: unknown;
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); },
    cancel(reason) { cancellations++; cancellationReason = reason; },
  });
  const state = new BodyState(stream, null, null, null, {
    maxConsumeBytes: 1,
    maxCloneBufferBytes: Infinity,
  });
  let failure: unknown;
  await assert.rejects(state.consume(), (error: unknown) => {
    failure = error;
    return error instanceof LimitError;
  });
  assert.equal(cancellations, 1);
  assert.equal(cancellationReason, failure);
});

const bodyFactories = [
  {
    name: "Response",
    create: (body: string, contentType: string): BodySurface =>
      new Response(body, { headers: { "content-type": contentType } }),
    oracle: (body: string, contentType: string): BodySurface =>
      new globalThis.Response(body, { headers: { "content-type": contentType } }),
  },
  {
    name: "Request",
    create: (body: string, contentType: string): BodySurface =>
      new Request("https://example.test/", { method: "POST", body, headers: { "content-type": contentType } }),
    oracle: (body: string, contentType: string): BodySurface =>
      new globalThis.Request("https://example.test/", { method: "POST", body, headers: { "content-type": contentType } }),
  },
];

// https://fetch.spec.whatwg.org/#concept-body-consume-body
// Body methods each consume the associated body, without calling sibling methods.
for (const factory of bodyFactories) {
  for (const fixture of [
    { method: "text", read: (body: BodySurface): Promise<unknown> => body.text() },
    { method: "arrayBuffer", read: async (body: BodySurface): Promise<unknown> =>
      Array.from(new Uint8Array(await body.arrayBuffer())) },
    { method: "blob", read: async (body: BodySurface): Promise<unknown> => (await body.blob()).text() },
    { method: "formData", read: async (body: BodySurface): Promise<unknown> => (await body.formData()).get("a") },
  ]) {
    test(`${factory.name}.${fixture.method} consumes its own body despite a shadowed bytes method`, async () => {
      const subject = factory.create("a=1", "application/x-www-form-urlencoded");
      const oracle = factory.oracle("a=1", "application/x-www-form-urlencoded");
      let calls = 0;
      const replacement = (): Promise<Uint8Array> => {
        calls++;
        return Promise.reject(new Error("public bytes method was invoked"));
      };
      subject.bytes = replacement;
      oracle.bytes = replacement;
      assert.deepEqual(await fixture.read(subject), await fixture.read(oracle));
      assert.equal(calls, 0);
      assert.equal(subject.bodyUsed, true);
      await assert.rejects(fixture.read(subject), TypeError);
      assert.equal(calls, 0);
    });
  }

  test(`${factory.name}.json consumes its own body despite shadowed text and bytes methods`, async () => {
    const subject = factory.create("7", "application/json");
    const oracle = factory.oracle("7", "application/json");
    let calls = 0;
    const replacement = (): never => {
      calls++;
      throw new Error("public body method was invoked");
    };
    subject.text = oracle.text = replacement;
    subject.bytes = oracle.bytes = replacement;
    assert.equal(await subject.json(), await oracle.json());
    assert.equal(calls, 0);
    assert.equal(subject.bodyUsed, true);
    await assert.rejects(subject.json(), TypeError);
    assert.equal(calls, 0);
  });
}

// https://fetch.spec.whatwg.org/#dom-response
// Dictionary conversion precedes extraction; extraction precedes initialization.
test("Response body extraction rejects a locked stream before checking status", () => {
  const stream = new ReadableStream<Uint8Array>();
  const oracleStream = new globalThis.ReadableStream<Uint8Array>();
  const reader = stream.getReader();
  const oracleReader = oracleStream.getReader();
  try {
    assert.throws(() => new globalThis.Response(oracleStream, { status: 0 }), TypeError);
    assert.throws(() => new Response(stream, { status: 0 }), TypeError);
  } finally {
    reader.releaseLock();
    oracleReader.releaseLock();
  }
});

test("Response body extraction rejects a disturbed stream before checking status", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const oracleStream = new globalThis.ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const reader = stream.getReader();
  const oracleReader = oracleStream.getReader();
  await reader.read();
  await oracleReader.read();
  reader.releaseLock();
  oracleReader.releaseLock();
  assert.throws(() => new globalThis.Response(oracleStream, { status: 0 }), TypeError);
  assert.throws(() => new Response(stream, { status: 0 }), TypeError);
});

test("Response body extraction follows complete init dictionary conversion", () => {
  const stream = new ReadableStream<Uint8Array>();
  const oracleStream = new globalThis.ReadableStream<Uint8Array>();
  const reader = stream.getReader();
  const oracleReader = oracleStream.getReader();
  const marker = new Error("status conversion");
  const init = { get status(): number { throw marker; } };
  try {
    assert.throws(() => new globalThis.Response(oracleStream, init), (error) => error === marker);
    assert.throws(() => new Response(stream, init), (error) => error === marker);
  } finally {
    reader.releaseLock();
    oracleReader.releaseLock();
  }
});

test("Response body extraction leaves a usable stream unlocked when status is invalid", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const oracleStream = new globalThis.ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  assert.throws(() => new globalThis.Response(oracleStream, { status: 0 }), RangeError);
  assert.throws(() => new Response(stream, { status: 0 }), RangeError);
  assert.equal(stream.locked, oracleStream.locked);
  assert.equal(await new Response(stream).text(), await new globalThis.Response(oracleStream).text());
});
