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

// https://webidl.spec.whatwg.org/#es-dictionary
// https://fetch.spec.whatwg.org/#initialize-a-response
for (const operation of ["constructor", "json"] as const) {
  const construct = (init: NonNullable<ConstructorParameters<typeof Response>[1]>): Response =>
    operation === "constructor" ? new Response(null, init) : Response.json(1, init);
  const oracle = (init: ConstructorParameters<typeof globalThis.Response>[1]): globalThis.Response =>
    operation === "constructor" ? new globalThis.Response(null, init) : globalThis.Response.json(1, init);

  for (const member of ["status", "statusText"] as const) {
    test(`Response ${operation} converts ${member} before validating header syntax`, () => {
      const marker = new Error(`${member} conversion`);
      const init = {
        headers: [["bad name", "value"]] as [string, string][],
        get status(): number {
          if (member === "status") throw marker;
          return 200;
        },
        get statusText(): string { throw marker; },
      };
      assert.throws(() => oracle(init), (error) => error === marker);
      assert.throws(() => construct(init), (error) => error === marker);
    });
  }

  test(`Response ${operation} validates status before filling converted headers`, () => {
    const init = { headers: [["bad name", "value"]] as [string, string][], status: 0 };
    assert.throws(() => oracle(init), RangeError);
    assert.throws(() => construct(init), RangeError);
  });

  test(`Response ${operation} still converts header ByteStrings before later dictionary members`, () => {
    let statusReads = 0;
    const init = {
      headers: [["x-name", "\u0100"]] as [string, string][],
      get status(): number { statusReads++; return 200; },
    };
    assert.throws(() => oracle(init), TypeError);
    assert.throws(() => construct(init), TypeError);
    assert.equal(statusReads, 0);
  });
}

test("Response json serializes its value before filling converted headers", () => {
  const marker = new Error("JSON serialization");
  const data = { toJSON(): never { throw marker; } };
  const init = { headers: [["bad name", "value"]] as [string, string][] };
  assert.throws(() => globalThis.Response.json(data, init), (error) => error === marker);
  assert.throws(() => Response.json(data, init), (error) => error === marker);
});

// https://fetch.spec.whatwg.org/#dom-response-ok
// https://fetch.spec.whatwg.org/#dom-response-clone
// Node's declarations model IDL getters as fields; use the actual accessor shape
// when deriving the oracle subclasses below.
const OracleResponse = globalThis.Response as unknown as typeof Response;

test("Response internal status determines ok even when the status getter is shadowed", () => {
  class Subject extends Response { override get status(): number { return 503; } }
  class Oracle extends OracleResponse { override get status(): number { return 503; } }
  const subject = new Subject(null, { status: 201 });
  const oracle = new Oracle(null, { status: 201 });
  assert.equal(oracle.ok, true);
  assert.equal(subject.ok, oracle.ok);
});

test("Response internal clone ignores shadowed status, statusText, and headers getters", async () => {
  let shadow = false;
  let reads = 0;
  const rejectShadow = (): void => {
    if (shadow) { reads++; throw new Error("public Response getter was read"); }
  };
  class Subject extends Response {
    override get status(): number { rejectShadow(); return super.status; }
    override get statusText(): string { rejectShadow(); return super.statusText; }
    override get headers(): Response["headers"] { rejectShadow(); return super.headers; }
  }
  class Oracle extends OracleResponse {
    override get status(): number { rejectShadow(); return super.status; }
    override get statusText(): string { rejectShadow(); return super.statusText; }
    override get headers(): Response["headers"] { rejectShadow(); return super.headers; }
  }
  const init = { status: 201, statusText: "Created", headers: { "x-original": "yes" } };
  const subject = new Subject("original", init);
  const oracle = new Oracle("original", init);
  shadow = true;
  const expected = oracle.clone();
  const actual = subject.clone();
  assert.equal(reads, 0);
  assert.equal(actual.status, expected.status);
  assert.equal(actual.statusText, expected.statusText);
  assert.equal(actual.headers.get("x-original"), expected.headers.get("x-original"));
  assert.equal(await actual.text(), await expected.text());
  assert.equal(await subject.text(), await oracle.text());
});

test("Response internal clone copies the header list without calling a shadowed iterator", () => {
  const subject = new Response(null, { headers: { "x-original": "yes" } });
  const oracle = new globalThis.Response(null, { headers: { "x-original": "yes" } });
  let iterations = 0;
  const replacement = function* (): Generator<[string, string]> {
    iterations++;
    yield ["x-injected", "wrong"];
  };
  subject.headers[Symbol.iterator] = replacement;
  (oracle.headers as { [Symbol.iterator](): Iterator<[string, string]> })[Symbol.iterator] = replacement;
  const actual = subject.clone();
  const expected = oracle.clone();
  assert.deepEqual(Array.from(actual.headers), Array.from(expected.headers));
  assert.equal(iterations, 0);
  actual.headers.set("x-original", "copy");
  assert.equal(subject.headers.get("x-original"), "yes");
});

test("Response internal MIME lookup ignores a shadowed Headers.get", async () => {
  const subject = new Response("value", { headers: { "content-type": "text/plain" } });
  const oracle = new globalThis.Response("value", { headers: { "content-type": "text/plain" } });
  let calls = 0;
  const replacement = (): never => { calls++; throw new Error("public Headers.get was called"); };
  subject.headers.get = replacement;
  (oracle.headers as { get(name: string): string | null }).get = replacement;
  const expected = await oracle.blob();
  const actual = await subject.blob();
  assert.equal(actual.type, expected.type);
  assert.equal(await actual.text(), await expected.text());
  assert.equal(calls, 0);
});

test("Response internal clone preserves error and redirect status and immutable headers", () => {
  for (const [subject, oracle] of [
    [Response.error(), globalThis.Response.error()],
    [Response.redirect("https://example.test/"), globalThis.Response.redirect("https://example.test/")],
  ] as const) {
    const actual = subject.clone();
    const expected = oracle.clone();
    assert.equal(actual.status, expected.status);
    assert.equal(actual.type, expected.type);
    assert.equal(actual.body, expected.body);
    assert.deepEqual(Array.from(actual.headers), Array.from(expected.headers));
    assert.throws(() => actual.headers.set("x-test", "value"), TypeError);
    assert.throws(() => expected.headers.set("x-test", "value"), TypeError);
  }
});
