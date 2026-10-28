// Specification controls for source-policy edge cases beyond the unedited WPT.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Headers } from "../src/fetch/headers.ts";
import type { HeadersInit } from "../src/fetch/headers.ts";
import { Request } from "../src/fetch/request.ts";
import { ReadableStream } from "../src/streams/readable.ts";

function useRuntime(t: TestContext): void {
  const runtime = createHostNodeWebPlatform();
  t.after(() => runtime.close());
}

// https://webidl.spec.whatwg.org/#es-union
// GetMethod treats both null and undefined as an absent iterator method.
for (const absent of [undefined, null]) {
  test(`Headers treats an inherited ${String(absent)} iterator as a record`, () => {
    let reads = 0;
    class HeaderRecord {
      x = "one";
      get [Symbol.iterator](): null | undefined {
        reads++;
        return absent;
      }
    }
    const headers = new Headers(new HeaderRecord() as unknown as HeadersInit);
    assert.equal(reads, 1);
    assert.deepEqual([...headers], [["x", "one"]]);
  });
}

// https://webidl.spec.whatwg.org/#create-sequence-from-iterable
test("Headers caches iterator methods and invokes them without reading their call properties", () => {
  let iteratorReads = 0;
  let nextReads = 0;
  let step = 0;
  let methodReceiver: unknown;
  let nextReceiver: unknown;
  const next = function (this: unknown): IteratorResult<string[]> {
    nextReceiver = this;
    return step++ === 0
      ? { done: false, value: ["x", "one"] }
      : { done: true, value: undefined };
  };
  (next as unknown as { call: () => never }).call = () => {
    throw new Error("iterator next.call is not part of abstract Call");
  };
  const iterator = {
    get next(): () => IteratorResult<string[]> {
      nextReads++;
      return next;
    },
  };
  const method = function (this: unknown): typeof iterator {
    methodReceiver = this;
    return iterator;
  };
  (method as unknown as { call: () => never }).call = () => {
    throw new Error("iterator method.call is not part of abstract Call");
  };
  const init = {
    get [Symbol.iterator](): () => typeof iterator {
      iteratorReads++;
      return method;
    },
  };
  const headers = new Headers(init as unknown as HeadersInit);
  assert.deepEqual([...headers], [["x", "one"]]);
  assert.equal(iteratorReads, 1);
  assert.equal(nextReads, 1);
  assert.equal(methodReceiver, init);
  assert.equal(nextReceiver, iterator);
});

test("Headers does not close either iterator when nested ByteString conversion fails", () => {
  let innerClosed = false;
  let outerClosed = false;
  function* entry(): Generator<unknown> {
    try {
      yield "x";
      yield Symbol("not a ByteString");
    } finally {
      innerClosed = true;
    }
  }
  function* init(): Generator<Generator<unknown>> {
    try {
      yield entry();
    } finally {
      outerClosed = true;
    }
  }
  assert.throws(() => new Headers(init() as unknown as HeadersInit), TypeError);
  assert.equal(innerClosed, false);
  assert.equal(outerClosed, false);
});

test("Headers converts a third tuple item before Fetch rejects the tuple length", () => {
  const marker = new Error("third item conversion");
  const init = [["x", "one", { toString(): never { throw marker; } }]];
  assert.throws(() => new Headers(init as unknown as HeadersInit), (error) => error === marker);
});

test("Headers completes outer sequence conversion before validating an earlier header", () => {
  const marker = new Error("later entry conversion");
  const order: string[] = [];
  function* init(): Generator<unknown[]> {
    order.push("first entry");
    yield ["bad name", "one"];
    order.push("second entry");
    yield ["x", { toString(): never { order.push("convert value"); throw marker; } }];
  }
  assert.throws(() => new Headers(init() as unknown as HeadersInit), (error) => error === marker);
  assert.deepEqual(order, ["first entry", "second entry", "convert value"]);
});

// https://webidl.spec.whatwg.org/#es-record
test("Headers converts each record value before reading the next one", () => {
  const order: string[] = [];
  const init = {
    get first(): object {
      order.push("get first");
      return { toString(): string { order.push("convert first"); return "one"; } };
    },
    get second(): object {
      order.push("get second");
      return { toString(): string { order.push("convert second"); return "two"; } };
    },
  };
  const headers = new Headers(init as unknown as HeadersInit);
  assert.deepEqual(order, ["get first", "convert first", "get second", "convert second"]);
  assert.deepEqual([...headers], [["first", "one"], ["second", "two"]]);
});

// https://fetch.spec.whatwg.org/#concept-headers-fill
test("Headers construction fills the internal list without invoking an overridden append", () => {
  class DerivedHeaders extends Headers {
    override append(): never {
      throw new Error("the constructor must run the internal append algorithm");
    }
  }
  const headers = new DerivedHeaders([["X", " one "]]);
  assert.equal(headers.get("x"), "one");
});

// https://webidl.spec.whatwg.org/#es-dictionary
// https://fetch.spec.whatwg.org/#dom-request
test("Request converts later dictionary members before HTTP header validation", (t) => {
  useRuntime(t);
  const marker = new Error("method getter");
  let reads = 0;
  assert.throws(() => new Request("https://example.test/", {
    headers: [["bad name", "one"]],
    get method(): never { reads++; throw marker; },
  }), (error) => error === marker);
  assert.equal(reads, 1);
});

test("Request still performs header ByteString conversion before later dictionary getters", (t) => {
  useRuntime(t);
  const marker = new Error("header value conversion");
  let methodReads = 0;
  const init = [["x", { toString(): never { throw marker; } }]];
  assert.throws(() => new Request("https://example.test/", {
    headers: init as unknown as HeadersInit,
    get method(): string { methodReads++; return "POST"; },
  }), (error) => error === marker);
  assert.equal(methodReads, 0);
});

test("Request snapshots converted header values once before later dictionary members", (t) => {
  useRuntime(t);
  const order: string[] = [];
  let value = "before";
  const init = [[
    { toString(): string { order.push("name"); return "x"; } },
    { toString(): string { order.push("value"); return value; } },
  ]];
  const request = new Request("https://example.test/", {
    get headers(): HeadersInit { order.push("headers"); return init as unknown as HeadersInit; },
    get method(): string { order.push("method"); value = "after"; return "POST"; },
  });
  assert.deepEqual(order, ["headers", "name", "value", "method"]);
  assert.equal(request.headers.get("x"), "before");
});

// https://webidl.spec.whatwg.org/#es-to-record
test("Headers rechecks a later record property's existence after an earlier getter", () => {
  const init: { readonly first: string; second?: string } = {
    get first(): string { delete init.second; return "one"; },
    second: "two",
  };
  const headers = new Headers(init);
  assert.deepEqual([...headers], [["first", "one"]]);
});

test("Headers rejects an enumerable symbol record key before reading its value", () => {
  const key = Symbol("not a ByteString key");
  let reads = 0;
  const init = {
    x: "one",
    get [key](): string { reads++; return "two"; },
  };
  assert.throws(() => new Headers(init), TypeError);
  assert.equal(reads, 0);
});

test("Headers rejects a non-ByteString record key before reading its value", () => {
  let reads = 0;
  const init = { get "\u0100"(): string { reads++; return "one"; } };
  assert.throws(() => new Headers(init), TypeError);
  assert.equal(reads, 0);
});

// https://webidl.spec.whatwg.org/#es-operations
// Missing arguments fail before any conversion; explicit undefined is a value.
for (const operation of ["append", "set"] as const) {
  test(`Headers.${operation} checks both required arguments before coercion or mutation`, () => {
    const headers = new Headers([["kept", "one"]]);
    const invoke = headers[operation] as (...args: unknown[]) => unknown;
    assert.throws(() => invoke.call(headers), TypeError);
    let reads = 0;
    const marker = new Error("name conversion");
    const name = { toString(): never { reads++; throw marker; } };
    assert.throws(() => invoke.call(headers, name), TypeError);
    assert.equal(reads, 0);
    assert.deepEqual([...headers], [["kept", "one"]]);
    invoke.call(headers, undefined, undefined);
    assert.equal(headers.get("undefined"), "undefined");
  });
}

// https://fetch.spec.whatwg.org/#dom-request
// The selected body with a null source requires same-origin or cors before an
// inherited stream is proxied, so constructor rejection leaves it untouched.
test("Request rejects a new no-cors stream body without consuming or cancelling it", async (t) => {
  useRuntime(t);
  const callbacks: string[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); },
    cancel() { callbacks.push("cancel"); },
  });
  assert.throws(() => new Request("https://example.test/", {
    method: "POST", mode: "no-cors", body, duplex: "half",
  }), TypeError);
  assert.equal(body.locked, false);
  assert.deepEqual(callbacks, []);
  const request = new Request("https://example.test/", {
    method: "POST", mode: "cors", body, duplex: "half",
  });
  assert.deepEqual(await request.bytes(), new Uint8Array([65]));
  assert.deepEqual(callbacks, []);
});

test("Request rejects an inherited no-cors stream body before transferring the original", async (t) => {
  useRuntime(t);
  const callbacks: string[] = [];
  const original = new Request("https://example.test/", {
    method: "POST", duplex: "half",
    body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); },
      cancel() { callbacks.push("cancel"); },
    }),
  });
  const originalBody = original.body;
  assert.ok(originalBody !== null);
  assert.throws(() => new Request(original, { mode: "no-cors" }), TypeError);
  assert.equal(original.body, originalBody);
  assert.equal(original.bodyUsed, false);
  assert.equal(originalBody.locked, false);
  assert.deepEqual(callbacks, []);
  assert.deepEqual(await original.bytes(), new Uint8Array([65]));
  assert.deepEqual(callbacks, []);
});

for (const mode of ["same-origin", "cors"] as const) {
  test(`Request accepts a ${mode} stream body and preserves its bytes`, async (t) => {
    useRuntime(t);
    const request = new Request("https://example.test/", {
      method: "POST", mode, duplex: "half",
      body: new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); },
      }),
    });
    assert.equal(request.mode, mode);
    assert.deepEqual(await request.bytes(), new Uint8Array([65]));
  });
}

test("Request permits an inherited replayable body in no-cors mode", async (t) => {
  useRuntime(t);
  const original = new Request("https://example.test/", { method: "POST", body: "original" });
  const request = new Request(original, { mode: "no-cors", body: null });
  assert.equal(original.bodyUsed, true);
  assert.equal(request.mode, "no-cors");
  assert.equal(await request.text(), "original");
  await assert.rejects(original.text(), TypeError);
});

test("Request checks the replacement body rather than an unused inherited stream", async (t) => {
  useRuntime(t);
  const original = new Request("https://example.test/", {
    method: "POST", duplex: "half",
    body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([65])); controller.close(); },
    }),
  });
  const request = new Request(original, { mode: "no-cors", body: "replacement" });
  assert.equal(original.bodyUsed, false);
  assert.equal(original.body?.locked, false);
  assert.equal(await request.text(), "replacement");
  assert.deepEqual(await original.bytes(), new Uint8Array([65]));
});

for (const operation of ["get", "has", "delete"] as const) {
  test(`Headers.${operation} distinguishes a missing name from explicit undefined`, () => {
    const headers = new Headers([["undefined", "one"]]);
    const invoke = headers[operation] as (...args: unknown[]) => unknown;
    assert.throws(() => invoke.call(headers), TypeError);
    assert.equal(headers.get("undefined"), "one");
    const result = invoke.call(headers, undefined);
    assert.equal(result, operation === "get" ? "one" : operation === "has" ? true : undefined);
    assert.equal(headers.has("undefined"), operation !== "delete");
  });
}

// https://webidl.spec.whatwg.org/#es-forEach
for (const empty of [true, false]) {
  test(`Headers.forEach validates its callback for an ${empty ? "empty" : "nonempty"} list`, () => {
    const headers = new Headers(empty ? [] : [["x", "one"]]);
    const invoke = headers.forEach as (...args: unknown[]) => unknown;
    assert.throws(() => invoke.call(headers), TypeError);
    let calls = 0;
    const noncallable = { call(): void { calls++; } };
    for (const value of [undefined, null, 0, {}, noncallable]) {
      assert.throws(() => invoke.call(headers, value), TypeError);
    }
    assert.equal(calls, 0);
    assert.equal(headers.forEach.length, 1);
  });
}

test("Headers.forEach uses abstract Call and observes mutations during traversal", () => {
  const headers = new Headers([["a", "one"], ["b", "two"]]);
  const context = {};
  const visited: string[] = [];
  const callback = function (this: unknown, value: string, name: string, parent: Headers): void {
    assert.equal(this, context);
    assert.equal(parent, headers);
    visited.push(name + "=" + value);
    if (name === "a") parent.append("c", "three");
  };
  (callback as unknown as { call: () => never }).call = () => {
    throw new Error("callback.call must not be read");
  };
  headers.forEach(callback, context);
  assert.deepEqual(visited, ["a=one", "b=two", "c=three"]);
});

test("Headers.forEach preserves a callback error and stops traversal", () => {
  const headers = new Headers([["a", "one"], ["b", "two"]]);
  const marker = new Error("callback failed");
  const visited: string[] = [];
  assert.throws(() => headers.forEach((_value, name) => {
    visited.push(name);
    throw marker;
  }), (error) => error === marker);
  assert.deepEqual(visited, ["a"]);
});

// https://fetch.spec.whatwg.org/#concept-body-mime-type
test("Request body MIME extraction ignores an overridden Headers.get", async (t) => {
  useRuntime(t);
  const request = new Request("https://example.test/", { method: "POST", body: "body" });
  const headers = request.headers;
  headers.set("content-type", "text/custom");
  let reads = 0;
  headers.get = (): never => { reads++; throw new Error("public get must not be called"); };
  const blob = await request.blob();
  assert.equal(reads, 0);
  assert.equal(blob.type, "text/custom");
  assert.equal(await blob.text(), "body");
});

test("Request body MIME extraction ignores an overridden headers getter", async (t) => {
  useRuntime(t);
  let reads = 0;
  class DerivedRequest extends Request {
    override get headers(): Headers {
      reads++;
      throw new Error("public headers must not be read");
    }
  }
  const request = new DerivedRequest("https://example.test/", {
    method: "POST", body: "body", headers: [["content-type", "text/custom"]],
  });
  const blob = await request.blob();
  assert.equal(reads, 0);
  assert.equal(blob.type, "text/custom");
  assert.equal(await blob.text(), "body");
});

// https://webidl.spec.whatwg.org/#es-operations
// https://fetch.spec.whatwg.org/#concept-headers-append
for (const operation of ["append", "set"] as const) {
  test(`Headers.${operation} converts its value before validating HTTP name syntax`, () => {
    const headers = new Headers([["kept", "one"]]);
    const marker = new Error("value conversion failed");
    let reads = 0;
    const value = { toString(): never { reads++; throw marker; } };
    assert.throws(() => headers[operation]("bad name", value as unknown as string),
      (error) => error === marker);
    assert.equal(reads, 1);
    assert.deepEqual([...headers], [["kept", "one"]]);
  });

  test(`Headers.${operation} converts each argument once in order and stops on conversion failure`, () => {
    const headers = new Headers();
    const order: string[] = [];
    const name = { toString(): string { order.push("name"); return "X"; } };
    const value = { toString(): string { order.push("value"); return " one "; } };
    headers[operation](name as unknown as string, value as unknown as string);
    assert.deepEqual(order, ["name", "value"]);
    assert.equal(headers.get("x"), "one");
    order.length = 0;
    assert.throws(() => headers[operation]("\u0100", value as unknown as string), TypeError);
    assert.deepEqual(order, []);
    assert.deepEqual([...headers], [["x", "one"]]);
  });
}
