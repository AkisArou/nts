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

/**
 * Interfaces whose prototypes carry no non-standard members, and whose members are therefore
 * safe to make enumerable as Web IDL requires.
 *
 * The list is short because the rest still expose internals; see
 * `idl-internal-surface.test.mjs`. Adding a class here without first clearing its internals
 * would enumerate those too, which is the ordering that makes this list the interesting part.
 */
const FULLY_CONFORMANT = [
  "AbortSignal",
  "Blob",
  "ByteLengthQueuingStrategy",
  "CountQueuingStrategy",
  "Event",
  "EventTarget",
  "File",
  "FormData",
  "Headers",
  "ReadableByteStreamController",
  "ReadableStreamDefaultController",
  "TransformStream",
  "TransformStreamDefaultController",
  "URLSearchParams",
  "WebSocket",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "TextDecoder",
  "TextDecoderStream",
  "TextEncoder",
  "TextEncoderStream",
];

/**
 * Interfaces whose prototypes are clean and enumerable but which still deviate in shape.
 *
 * `Request` and `Response` include the `Body` mixin. Web IDL says an included mixin's members
 * are **copied onto the interface prototype**; here they are inherited from a shared `Body`
 * base class instead. Every value reads correctly, `instanceof` is unaffected, and the
 * difference is visible only in `Object.getOwnPropertyNames(Request.prototype)` and
 * `Request.prototype.hasOwnProperty("json")`.
 *
 * They were listed as fully conformant until the name-completeness check below was written,
 * which is the assertion that found it. Recorded rather than fixed: making the mixin members
 * own properties means the prototype chain stops inheriting from `Body`, which is a change to
 * a hierarchy that four other interfaces sit on.
 */
const MIXIN_INHERITED = ["Request", "Response"];

suite("members of a cleared interface are enumerable, as Web IDL requires", () => {
  const wrong = [];
  for (const name of [...FULLY_CONFORMANT, ...MIXIN_INHERITED]) {
    for (const key of Object.getOwnPropertyNames(api[name].prototype)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(api[name].prototype, key);
      if (!descriptor.enumerable) wrong.push(`${name}.${key}`);
    }
  }
  assert.deepEqual(wrong, []);
});

suite("making them enumerable did not expose an internal", () => {
  // The other half of the same change. `getOwnPropertyNames` skips symbol keys, so the
  // internals other modules reach are untouched by the enumerability pass -- and that is
  // exactly why the pass is safe on these classes and not on the rest.
  for (const name of [...FULLY_CONFORMANT, ...MIXIN_INHERITED]) {
    const conformant = globalThis[name];
    if (typeof conformant !== "function") continue;
    const theirs = new Set([
      ...Object.getOwnPropertyNames(conformant.prototype),
      ...(CONSTANTS_ON_PROTOTYPE[name] ?? []),
      ...(ORACLE_OMITS[name] ?? []),
    ]);
    const extra = Object.getOwnPropertyNames(api[name].prototype).filter(
      (key) => key !== "constructor" && !theirs.has(key),
    );
    assert.deepEqual(extra, [], `${name} must expose no non-standard names`);
  }
});

/**
 * Members that other lanes reach **reflectively**, by name, as a duck-type brand check.
 *
 * Reported by the Node lane, which has five sites of the shape `!("aborted" in signal)` --
 * in `internal/validators.ts`, `util/src/main.ts` and two files under `stream/src/iter/`.
 * They are the argument for this suite existing in this form.
 *
 * The hazard is specific and it is the mirror of a defect this lane shipped and caught: a
 * reflective check is invisible to `tsc` -- the property genuinely might not exist, which is
 * what the check is asking -- so symbol-keying or privatising one of these names produces no
 * compile error here, no failing conformance test here, and five silent rejections of
 * perfectly valid `AbortSignal`s over there.
 *
 * These names stay named because Web IDL says so. This records that they are also
 * load-bearing outside this lane, so the decision is made knowingly rather than discovered.
 */
const REFLECTIVELY_REACHED = {
  AbortSignal: ["aborted"],
};

/**
 * Members the conformant oracle has that the standard does not define.
 *
 * Node is a good oracle for interface shape and it is not the IDL. `Blob.prototype.textStream`
 * is a Node extension: `interfaces/FileAPI.idl`, pinned in this repository, declares `stream()`
 * and `text()` and nothing else on `Blob`. Excluded by citation rather than by convenience --
 * this is checkable, and the check is that the IDL does not mention it.
 */
const HOST_EXTENSIONS = {
  Blob: ["textStream"],
  File: ["textStream"],
};

/**
 * Names this runtime has on a prototype that the oracle does not, and is right to have.
 *
 * Web IDL puts an interface's constants on **both** the interface object and the interface
 * prototype object. Node keeps `Event`'s four on the constructor only, so comparing prototypes
 * reports them as extras here. `interfaces/dom.idl` declares them as `const unsigned short`
 * members of `Event`, which is the citation.
 */
const CONSTANTS_ON_PROTOTYPE = {
  Event: ["NONE", "CAPTURING_PHASE", "AT_TARGET", "BUBBLING_PHASE"],
  WebSocket: ["CONNECTING", "OPEN", "CLOSING", "CLOSED"],
};

/**
 * Standard members this runtime has that the oracle does not implement.
 *
 * `CustomEvent.initCustomEvent` is declared in `interfaces/dom.idl` — marked `// legacy`, but
 * declared — and node does not provide it. Listed so that having it does not read as an extra.
 */
const ORACLE_OMITS = {
  CustomEvent: ["initCustomEvent"],
};

/**
 * `[LegacyUnforgeable]` members, which belong on the **instance** and not the prototype.
 *
 * `Event.isTrusted` is the only one here. Node exposes it as a prototype accessor; this
 * runtime defines it as a own, non-configurable accessor per instance, which is what the
 * extended attribute requires and what the pinned `dom/events/Event-isTrusted.any.js`
 * fixture asserts. So its absence from this prototype is the conformant answer.
 */
const LEGACY_UNFORGEABLE = {
  Event: ["isTrusted"],
};

suite("every standard member is still reachable by its own name", () => {
  // The direction the extras check cannot see. `getOwnPropertyNames` skipping symbols is what
  // makes symbol-keying an internal invisible -- and it would make symbol-keying a *public*
  // member equally invisible, while breaking every consumer that looks the name up.
  const missing = [];
  for (const name of FULLY_CONFORMANT) {
    const conformant = globalThis[name];
    if (typeof conformant !== "function") continue;
    const mine = new Set(Object.getOwnPropertyNames(api[name].prototype));
    const excused = new Set([
      ...(HOST_EXTENSIONS[name] ?? []),
      ...(LEGACY_UNFORGEABLE[name] ?? []),
    ]);
    for (const key of Object.getOwnPropertyNames(conformant.prototype)) {
      if (key === "constructor" || excused.has(key)) continue;
      if (!mine.has(key)) missing.push(`${name}.${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

suite("members other lanes brand-check by name are named, not symbol-keyed", () => {
  for (const [name, keys] of Object.entries(REFLECTIVELY_REACHED)) {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(api[name].prototype, key);
      assert.notEqual(
        descriptor,
        undefined,
        `${name}.${key} is reached reflectively by another lane; see the note above`,
      );
      // `in` walks the prototype chain and finds accessors, so an own accessor is what the
      // consuming check actually needs -- asserted as the shape, not merely as a truthy read.
      assert.ok(
        typeof descriptor.get === "function" || "value" in descriptor,
        `${name}.${key} must be a real prototype member`,
      );
      assert.ok(
        key in new api.AbortController().signal,
        `${key} must answer an "in" check on this runtime's signal, not the host's`,
      );
    }
  }
});

suite("the mixin deviation is exactly what it is claimed to be", () => {
  // Pinned in the direction it currently holds, so that fixing it fails here and the note
  // above has to be removed rather than quietly outliving its reason.
  for (const name of MIXIN_INHERITED) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(api[name].prototype, "json"),
      false,
      `${name}.prototype owns its Body members now -- the mixin deviation is fixed`,
    );
    assert.equal(
      typeof api[name].prototype.json,
      "function",
      `${name} must still reach the Body members by inheritance`,
    );
  }
});

suite("a [LegacyUnforgeable] member is an own accessor, not a prototype one", () => {
  // The reason `Event.isTrusted` is excused above, asserted rather than assumed. It has to be
  // per-instance and non-configurable, which is what makes it unforgeable; a prototype
  // accessor would be replaceable for every event at once.
  const event = new api.Event("x");
  const own = Object.getOwnPropertyDescriptor(event, "isTrusted");
  assert.notEqual(own, undefined, "isTrusted must be an own property of the instance");
  assert.equal(typeof own.get, "function");
  assert.equal(own.configurable, false, "unforgeable means non-configurable");
  assert.equal(
    Object.getOwnPropertyDescriptor(api.Event.prototype, "isTrusted"),
    undefined,
    "and it must not also be on the prototype",
  );
});

suite("interface constants are on the prototype as well as the interface object", () => {
  for (const [name, constants] of Object.entries(CONSTANTS_ON_PROTOTYPE)) {
    for (const key of constants) {
      const descriptor = Object.getOwnPropertyDescriptor(api[name].prototype, key);
      assert.notEqual(descriptor, undefined, `${name}.prototype.${key}`);
      assert.equal(descriptor.writable, false, `${name}.${key} must not be writable`);
      assert.equal(descriptor.configurable, false, `${name}.${key} must not be configurable`);
      assert.equal(typeof api[name][key], "number", `${name}.${key} must also be on the class`);
    }
  }
});
