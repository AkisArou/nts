// Web IDL surface shape: `@@toStringTag` and constructor arity.
//
// WPT tests this through `idlharness`, which this corpus does not pin -- it needs the IDL
// definitions and a harness that parses them, which is a much larger dependency than a
// fixture file. So the surface was entirely unchecked here, and it was wrong in two ways
// that no behavioural test would ever notice.
//
// The oracle is the IDL text, not node. Node agrees with it on every interface it
// implements, and that agreement is worth having, but it is a cross-check rather than the
// authority: this lane has already found one place where node's own answer was the wrong
// one, and a table copied from a running implementation is a table chosen by whatever that
// implementation happens to do.
import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

/**
 * Every Web IDL interface this runtime exports, and the constructor arity its IDL states.
 *
 * `length` is the number of *required* arguments. `null` means the interface has no
 * constructor, so only the tag is checked.
 */
const INTERFACES = {
  AbortController: 0,
  AbortSignal: null,
  Blob: 0,
  ByteLengthQueuingStrategy: 1,
  Cache: null,
  CacheStorage: null,
  CloseEvent: 1,
  CountQueuingStrategy: 1,
  CustomEvent: 1,
  DOMException: 0,
  ErrorEvent: 1,
  Event: 1,
  EventSource: 1,
  EventTarget: 0,
  File: 2,
  FormData: 0,
  Headers: 0,
  MessageEvent: 1,
  ReadableByteStreamController: null,
  ReadableStream: 0,
  ReadableStreamBYOBReader: 1,
  ReadableStreamBYOBRequest: null,
  ReadableStreamDefaultController: null,
  ReadableStreamDefaultReader: 1,
  Request: 1,
  Response: 0,
  TextDecoder: 0,
  TextDecoderStream: 0,
  TextEncoder: 0,
  TextEncoderStream: 0,
  TransformStream: 0,
  TransformStreamDefaultController: null,
  URLSearchParams: 0,
  WebSocket: 1,
  WebSocketStream: 1,
  WritableStream: 0,
  WritableStreamDefaultController: null,
  WritableStreamDefaultWriter: 1,
};

suite("every Web IDL interface prototype carries its @@toStringTag", () => {
  const wrong = [];
  for (const name of Object.keys(INTERFACES)) {
    const constructor = api[name];
    assert.equal(typeof constructor, "function", `${name} must be exported`);
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, Symbol.toStringTag);
    if (descriptor === undefined) {
      wrong.push(`${name}: absent`);
      continue;
    }
    // A data property, specifically. A `get [Symbol.toStringTag]()` accessor produces the
    // right string and the wrong shape, and it is the natural thing to write in a class
    // body -- so this asserts the descriptor rather than the string it yields.
    if (!("value" in descriptor)) {
      wrong.push(`${name}: accessor, not a data property`);
      continue;
    }
    if (
      descriptor.value !== name ||
      descriptor.writable !== false ||
      descriptor.enumerable !== false ||
      descriptor.configurable !== true
    ) {
      wrong.push(`${name}: ${JSON.stringify(descriptor)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

suite("the tag is what Object.prototype.toString actually reports", () => {
  // The consequence, and the reason the descriptor is worth pinning: without the tag this
  // answers `[object Object]`, which is directly observable and differs from every other
  // implementation.
  assert.equal(Object.prototype.toString.call(new api.Event("x")), "[object Event]");
  assert.equal(Object.prototype.toString.call(new api.Headers()), "[object Headers]");
  assert.equal(Object.prototype.toString.call(new api.AbortController()), "[object AbortController]");
  assert.equal(Object.prototype.toString.call(new api.TextEncoder()), "[object TextEncoder]");
});

suite("a constructor's length is its required-argument count", () => {
  const wrong = [];
  for (const [name, length] of Object.entries(INTERFACES)) {
    if (length === null) continue;
    if (api[name].length !== length) wrong.push(`${name}: ${api[name].length} want ${length}`);
  }
  assert.deepEqual(wrong, []);
});

suite("length is declared, not inferred, and stays right when the signature is a tuple", () => {
  // The classes take `...args` tuples so an omitted argument is distinguishable from an
  // explicit `undefined` -- which Web IDL also requires, and which matters more than the
  // arity. That makes the inferred length 0 for all of them, so the arity is declared.
  // This asserts both halves still hold together.
  assert.equal(api.Event.length, 1);
  assert.throws(() => new api.Event(), TypeError, "an omitted required argument still throws");
  assert.equal(new api.Event("x", undefined).type, "x", "an explicit undefined init is allowed");
});

suite("the Undici-shaped classes are deliberately untagged", () => {
  // Not Web IDL interfaces, and no implementation tags them. Asserted so that a later pass
  // adding tags "for consistency" has to change this test and say why.
  for (const name of ["Agent", "Pool", "RetryInterceptor", "MockAgent", "CookieJar"]) {
    const constructor = api[name];
    assert.equal(typeof constructor, "function", `${name} must be exported`);
    assert.equal(
      Object.getOwnPropertyDescriptor(constructor.prototype, Symbol.toStringTag),
      undefined,
      `${name} is not a Web IDL interface and must not be tagged`,
    );
  }
});
