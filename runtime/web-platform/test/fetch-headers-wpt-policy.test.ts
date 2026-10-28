// Specification controls for source-policy edge cases beyond the unedited WPT.
import "../host/environment-shim.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { Headers } from "../src/fetch/headers.ts";
import type { HeadersInit } from "../src/fetch/headers.ts";
import { Request } from "../src/fetch/request.ts";

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
