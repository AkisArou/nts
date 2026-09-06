// Adapted from the verified external delivery after removing its synthetic realm API.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Headers,
  Request,
  Response,
  ReadableStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  AbortController,
  AbortSignal,
  CloseEvent,
  CustomEvent,
  DOMException,
  Event,
  EventTarget,
  ErrorEvent,
  MessageEvent,
  TextEncoder,
  TextDecoder,
  Blob,
  File,
  FormData,
  URLSearchParams,
  WritableStream,
  WritableStreamDefaultController,
  WritableStreamDefaultWriter,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { encodeMultipart } from "../node_modules/.tsbuild/host/runtime/web-platform/src/forms/multipart.js";
import { _createBlobFromExternalSource } from "../node_modules/.tsbuild/host/runtime/web-platform/src/file/blob.js";
import {
  bytesStream,
  tee,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/streams/readable.js";
import { BufferedReader } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/io.js";
import {
  contentLength,
  hasToken,
  parseChunkSize,
  readHead,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/parser.js";
import {
  toClampedUnsignedShort,
  toUSVString,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/core/webidl.js";
import {
  closePayload,
  encodeFrame,
  isValidWireCloseCode,
  parseClose,
  readFrame,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/websocket/codec.js";
import { websocketAccept } from "../node_modules/.tsbuild/host/runtime/web-platform/src/websocket/handshake.js";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
const NativeHeaders = globalThis.Headers;
const NativeDecoder = globalThis.TextDecoder;
const NativeEncoder = globalThis.TextEncoder;
const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeFormData = globalThis.FormData;
const NativeURLSearchParams = globalThis.URLSearchParams;
const NativeBlob = globalThis.Blob;
const NativeFile = globalThis.File;
const NativeDOMException = globalThis.DOMException;
const NativeCustomEvent = globalThis.CustomEvent;
globalThis.fetch = () => {
  throw new Error("Host fetch is forbidden");
};
globalThis.WebSocket = class {
  constructor() {
    throw new Error("Host WebSocket is forbidden");
  }
};
const api = createHostNodeWebPlatform({}, {}, (error) => {
  throw error;
});
const makeRequest = (input, init = {}) => new Request(input, init, api.requestContext);
const makeResponse = (body = null, init = {}) => new Response(body, init, api.requestContext);
const makeRedirectResponse = (url, status = 302) =>
  Response.redirect(url, status, api.requestContext.urls);
const utf8 = new TextEncoder();
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function collectWeakReference(reference) {
  assert.equal(typeof globalThis.gc, "function", "the conformance runner must expose GC");
  for (let attempt = 0; attempt < 100; attempt++) {
    await tick();
    globalThis.gc();
    await tick();
    if (reference.deref() === undefined) return true;
  }
  return false;
}

test("Web event constructors consume typed init dictionaries", () => {
  const source = new EventTarget();
  const port = new EventTarget();
  const ports = [port];
  const message = new MessageEvent("message", {
    bubbles: true,
    composed: true,
    data: "payload",
    lastEventId: "42",
    origin: "https://example.test",
    ports,
    source,
  });
  ports.length = 0;
  assert.equal(message.bubbles, true);
  assert.equal(message.cancelable, false);
  assert.equal(message.composed, true);
  assert.equal(message.data, "payload");
  assert.equal(message.lastEventId, "42");
  assert.equal(message.origin, "https://example.test");
  assert.deepEqual(message.ports, [port]);
  assert.equal(message.source, source);

  const close = new CloseEvent("close", { code: 1000, reason: "done", wasClean: true });
  assert.equal(close.code, 1000);
  assert.equal(close.reason, "done");
  assert.equal(close.wasClean, true);

  const cause = new Error("boom");
  const error = new ErrorEvent("error", {
    colno: 7,
    error: cause,
    filename: "module.ts",
    lineno: 3,
    message: "boom",
  });
  assert.equal(error.colno, 7);
  assert.equal(error.error, cause);
  assert.equal(error.filename, "module.ts");
  assert.equal(error.lineno, 3);
  assert.equal(error.message, "boom");

  const defaults = new MessageEvent("message");
  assert.equal(defaults.data, null);
  assert.equal(defaults.origin, "");
  assert.deepEqual(defaults.ports, []);
  assert.equal(defaults.source, null);
});
test("Web event constructors apply Web IDL conversion once and in member order", () => {
  const trace = (Constructor, members) => {
    const reads = [];
    const init = {};
    for (const member of members) {
      Object.defineProperty(init, member, {
        get() {
          reads.push(member);
          return undefined;
        },
      });
    }
    new Constructor(
      {
        toString() {
          reads.push("type");
          return "event";
        },
      },
      init,
    );
    return reads;
  };

  for (const [Actual, members] of [
    [Event, ["bubbles", "cancelable", "composed"]],
    [CustomEvent, ["bubbles", "cancelable", "composed", "detail"]],
    [
      MessageEvent,
      ["bubbles", "cancelable", "composed", "data", "lastEventId", "origin", "ports", "source"],
    ],
    [CloseEvent, ["bubbles", "cancelable", "composed", "code", "reason", "wasClean"]],
    [
      ErrorEvent,
      ["bubbles", "cancelable", "composed", "colno", "error", "filename", "lineno", "message"],
    ],
  ]) {
    assert.deepEqual(trace(Actual, members), ["type", ...members]);
  }

  for (const [Actual, Expected] of [
    [Event, globalThis.Event],
    [CustomEvent, NativeCustomEvent],
    [MessageEvent, globalThis.MessageEvent],
    [CloseEvent, globalThis.CloseEvent],
  ]) {
    assert.equal(new Actual(42, null).type, new Expected(42, null).type);
    assert.throws(() => new Actual("event", 1), TypeError);
    assert.throws(() => new Expected("event", 1), TypeError);
  }
  assert.throws(() => new Event(Symbol("type")), TypeError);
  for (const Constructor of [Event, CustomEvent, MessageEvent, CloseEvent, ErrorEvent]) {
    assert.throws(() => new Constructor(), TypeError);
  }

  const close = new CloseEvent("close", { code: "1.9", reason: null });
  const nativeClose = new globalThis.CloseEvent("close", { code: "1.9", reason: null });
  assert.deepEqual([close.code, close.reason], [nativeClose.code, nativeClose.reason]);

  const message = new MessageEvent("message", {
    lastEventId: null,
    origin: "\ud800",
    ports: (function* () {
      yield new EventTarget();
    })(),
  });
  assert.equal(message.lastEventId, "null");
  assert.equal(message.origin, "\ufffd");
  assert.equal(message.ports.length, 1);
  assert.throws(() => new MessageEvent("message", { ports: null }), TypeError);
  assert.throws(() => new MessageEvent("message", { source: {} }), TypeError);

  const error = new ErrorEvent(null, {
    colno: "2.9",
    filename: null,
    lineno: 4_294_967_297,
    message: "\ud800",
  });
  assert.deepEqual(
    [error.type, error.colno, error.filename, error.lineno, error.message],
    ["null", 2, "null", 1, "\ud800"],
  );

  const initialized = new MessageEvent("before");
  initialized.initMessageEvent("after", false, false, null, null, null, null, []);
  assert.deepEqual([initialized.origin, initialized.lastEventId], ["null", "null"]);
  assert.throws(
    () => initialized.initMessageEvent("after", false, false, null, "", "", null, null),
    TypeError,
  );
});
test("DOMException legacy constants and active codes match Node", () => {
  const constantNames = [
    "INDEX_SIZE_ERR",
    "DOMSTRING_SIZE_ERR",
    "HIERARCHY_REQUEST_ERR",
    "WRONG_DOCUMENT_ERR",
    "INVALID_CHARACTER_ERR",
    "NO_DATA_ALLOWED_ERR",
    "NO_MODIFICATION_ALLOWED_ERR",
    "NOT_FOUND_ERR",
    "NOT_SUPPORTED_ERR",
    "INUSE_ATTRIBUTE_ERR",
    "INVALID_STATE_ERR",
    "SYNTAX_ERR",
    "INVALID_MODIFICATION_ERR",
    "NAMESPACE_ERR",
    "INVALID_ACCESS_ERR",
    "VALIDATION_ERR",
    "TYPE_MISMATCH_ERR",
    "SECURITY_ERR",
    "NETWORK_ERR",
    "ABORT_ERR",
    "URL_MISMATCH_ERR",
    "QUOTA_EXCEEDED_ERR",
    "TIMEOUT_ERR",
    "INVALID_NODE_TYPE_ERR",
    "DATA_CLONE_ERR",
  ];
  const actual = new DOMException();
  const expected = new NativeDOMException();
  for (const name of constantNames) {
    assert.equal(DOMException[name], NativeDOMException[name], name + " constructor constant");
    assert.equal(actual[name], expected[name], name + " instance constant");
  }

  const exceptionNames = [
    "IndexSizeError",
    "DOMStringSizeError",
    "HierarchyRequestError",
    "WrongDocumentError",
    "InvalidCharacterError",
    "NoDataAllowedError",
    "NoModificationAllowedError",
    "NotFoundError",
    "NotSupportedError",
    "InUseAttributeError",
    "InvalidStateError",
    "SyntaxError",
    "InvalidModificationError",
    "NamespaceError",
    "InvalidAccessError",
    "ValidationError",
    "TypeMismatchError",
    "SecurityError",
    "NetworkError",
    "AbortError",
    "URLMismatchError",
    "QuotaExceededError",
    "TimeoutError",
    "InvalidNodeTypeError",
    "DataCloneError",
    "OperationError",
    "NotReadableError",
  ];
  for (const name of exceptionNames) {
    assert.equal(
      new DOMException("message", name).code,
      new NativeDOMException("message", name).code,
    );
  }
});

for (const pairs of [
  [],
  [
    ["X-A", " 1 "],
    ["x-a", "2"],
    ["Set-Cookie", "a=1"],
    ["Set-Cookie", "b=2"],
  ],
  [
    ["z", ""],
    ["a", "a\tb"],
    ["a", "c"],
  ],
]) {
  test("Headers differential: " + JSON.stringify(pairs), () => {
    const actual = new Headers(pairs);
    const expected = new NativeHeaders(pairs);
    assert.deepEqual([...actual], [...expected]);
    assert.deepEqual(actual.getSetCookie(), expected.getSetCookie());
  });
}
test("Fetch-standard duplicate Cookie uses comma, unlike the Node host oracle", () => {
  // Fetch #concept-header-list-get: 0x2C 0x20, including Cookie. This is intentional.
  assert.equal(
    new Headers([
      ["cookie", "a=1"],
      ["cookie", "b=2"],
    ]).get("cookie"),
    "a=1, b=2",
  );
});
test("Web collection forEach methods apply thisArg as the callback receiver", () => {
  const marker = { marker: true };
  const pairs = [
    [new Headers([["x", "1"]]), new NativeHeaders([["x", "1"]])],
    [new URLSearchParams("x=1"), new NativeURLSearchParams("x=1")],
    [
      (() => {
        const value = new FormData();
        value.append("x", "1");
        return value;
      })(),
      (() => {
        const value = new NativeFormData();
        value.append("x", "1");
        return value;
      })(),
    ],
  ];

  for (const [actual, expected] of pairs) {
    const actualCalls = [];
    const expectedCalls = [];

    actual.forEach(function (value, name, parent) {
      assert.equal(this, marker);
      actualCalls.push([value, name, parent === actual]);
    }, marker);
    expected.forEach(function (value, name, parent) {
      assert.equal(this, marker);
      expectedCalls.push([value, name, parent === expected]);
    }, marker);
    assert.deepEqual(actualCalls, expectedCalls);
  }
});
test("Form collection mutation remains live and ordered", () => {
  const formFactory = (Constructor) => {
    const value = new Constructor();
    value.append("a", "1");
    value.append("b", "2");
    value.append("a", "3");
    value.append("c", "4");
    return value;
  };
  const cases = [
    [new URLSearchParams("a=1&b=2&a=3&c=4"), new NativeURLSearchParams("a=1&b=2&a=3&c=4")],
    [formFactory(FormData), formFactory(NativeFormData)],
  ];

  for (const [actual, expected] of cases) {
    const setActual = actual.entries();
    const setExpected = expected.entries();
    assert.deepEqual(setActual.next(), setExpected.next());
    actual.set("a", "9");
    expected.set("a", "9");
    assert.deepEqual([...setActual], [...setExpected]);
    assert.deepEqual([...actual], [...expected]);

    actual.append("a", "10");
    expected.append("a", "10");
    const deleteActual = actual.entries();
    const deleteExpected = expected.entries();
    assert.deepEqual(deleteActual.next(), deleteExpected.next());
    actual.delete("b");
    expected.delete("b");
    assert.deepEqual([...deleteActual], [...deleteExpected]);
    assert.deepEqual([...actual], [...expected]);
  }
});
test("Headers validation, guard and raw ownership", () => {
  for (const name of ["", "a b", "x\r\ny", ":a", "é"])
    assert.throws(() => new Headers([[name, "ok"]]));
  for (const value of ["\0", "a\rb", "a\nb", "€"]) assert.throws(() => new Headers([["a", value]]));
  const headers = new Headers([
    ["a", "1"],
    ["b", "x"],
    ["a", "2"],
  ]);
  headers.set("A", "3");
  assert.deepEqual(headers.raw(), [
    ["a", "3"],
    ["b", "x"],
  ]);
  const raw = headers.raw();
  raw[0][1] = "bad";
  assert.equal(headers.get("a"), "3");
  headers.makeImmutable();
  assert.throws(() => headers.delete("a"), TypeError);
});
test("Headers enforces sequence pairs and ByteString boundary conversion", () => {
  const actual = new Headers();
  const expected = new NativeHeaders();
  for (const headers of [actual, expected]) {
    headers.append(1, true);
    headers.set(false, 0);
  }
  assert.deepEqual([...actual], [...expected]);
  assert.equal(actual.get(1), expected.get(1));
  assert.equal(actual.has(false), expected.has(false));
  actual.delete(false);
  expected.delete(false);
  assert.deepEqual([...actual], [...expected]);

  const entry = function* () {
    yield 2;
    yield "é";
  };
  assert.deepEqual([...new Headers([entry()])], [...new NativeHeaders([entry()])]);

  for (const pair of [["name"], ["name", "value", "extra"], "nv"]) {
    assert.throws(() => new Headers([pair]), TypeError);
    assert.throws(() => new NativeHeaders([pair]), TypeError);
  }
  assert.throws(() => actual.append("x", "€"), TypeError);
  assert.throws(() => expected.append("x", "€"), TypeError);
  assert.throws(() => actual.append("x", Symbol("value")), TypeError);
  assert.throws(() => expected.append("x", Symbol("value")), TypeError);
});
test("Headers live iteration observes insertion and removal", () => {
  const actual = new Headers([
    ["b", "2"],
    ["c", "3"],
  ]);
  const expected = new NativeHeaders([
    ["b", "2"],
    ["c", "3"],
  ]);
  const consume = (h) => {
    const i = h.entries();
    const out = [i.next().value];
    h.set("a", "1");
    out.push(i.next().value);
    h.delete("c");
    out.push(i.next());
    return out;
  };
  assert.deepEqual(consume(actual), consume(expected));
});
test("Headers compacts duplicate fields in place at their first wire position", () => {
  const input = [];
  for (let index = 0; index < 2050; index++) {
    input.push(index % 3 === 1 ? ["target", String(index)] : [`x-${index}`, String(index)]);
  }
  const headers = new Headers(input);
  const firstTarget = headers.raw().findIndex((entry) => entry[0] === "target");
  headers.set("TARGET", "final");
  const replaced = headers.raw();
  assert.equal(
    replaced.findIndex((entry) => entry[0] === "target"),
    firstTarget,
  );
  assert.equal(replaced.filter((entry) => entry[0] === "target").length, 1);
  assert.equal(headers.get("target"), "final");

  headers.delete("target");
  assert.equal(headers.has("target"), false);
  assert.equal(headers.raw().length, 2050 - Math.floor(2050 / 3));
});
test("UTF-8 encode and encodeInto match host including lone surrogates", () => {
  for (const text of [
    "",
    "ASCII",
    "Καλημέρα",
    "💙",
    "\ud800a\udc00",
    "\ufeffA",
    "x".repeat(10000),
  ]) {
    assert.deepEqual(utf8.encode(text), new NativeEncoder().encode(text));
    for (let size = 0; size < 12; size++) {
      const a = new Uint8Array(size),
        b = new Uint8Array(size);
      assert.deepEqual(utf8.encodeInto(text, a), new NativeEncoder().encodeInto(text, b));
      assert.deepEqual(a, b);
    }
  }
});
test("TextEncoder applies Web IDL string conversion at both encode boundaries", () => {
  const encoder = new TextEncoder();
  const native = new NativeEncoder();
  const coercible = {
    toString() {
      return "value\ud800";
    },
  };

  for (const value of [null, 42, true, coercible]) {
    assert.deepEqual(encoder.encode(value), native.encode(value));
  }
  assert.throws(() => encoder.encode(Symbol("value")), TypeError);
  assert.throws(() => native.encode(Symbol("value")), TypeError);

  for (const [value, expected] of [
    [undefined, "undefined"],
    [null, "null"],
    [42, "42"],
    [true, "true"],
    [coercible, "value\ufffd"],
  ]) {
    const destination = new Uint8Array(32);
    const progress = encoder.encodeInto(value, destination);
    assert.deepEqual(destination.subarray(0, progress.written), encoder.encode(expected));
    assert.equal(progress.read, expected.length);
  }
  assert.throws(() => encoder.encodeInto(Symbol("value"), new Uint8Array(16)), TypeError);

  assert.throws(() => encoder.encodeInto(), TypeError);
  assert.throws(() => encoder.encodeInto("value"), TypeError);
  assert.throws(() => encoder.encodeInto("value", new Int8Array(16)), TypeError);

  const order = [];
  assert.throws(
    () =>
      encoder.encodeInto(
        {
          toString() {
            order.push("source");
            return "value";
          },
        },
        new Int8Array(16),
      ),
    TypeError,
  );
  assert.deepEqual(order, ["source"]);

  // Node 24 rejects these non-string sources despite the normative USVString
  // declaration. Keep the version difference visible instead of copying it.
  assert.throws(() => native.encodeInto(42, new Uint8Array(16)), TypeError);
});
test("TextDecoder converts labels and dictionaries before constructing state", () => {
  const order = [];
  const decoder = new TextDecoder(
    {
      toString() {
        order.push("label");
        return "UTF8";
      },
    },
    {
      get fatal() {
        order.push("fatal");
        return "enabled";
      },
      get ignoreBOM() {
        order.push("ignoreBOM");
        return 0;
      },
    },
  );
  assert.deepEqual(order, ["label", "fatal", "ignoreBOM"]);
  assert.equal(decoder.encoding, "utf-8");
  assert.equal(decoder.fatal, true);
  assert.equal(decoder.ignoreBOM, false);
  assert.throws(() => {
    decoder.fatal = false;
  }, TypeError);
  assert.throws(() => {
    decoder.ignoreBOM = true;
  }, TypeError);
  const encoder = new TextEncoder();
  assert.throws(() => {
    encoder.encoding = "utf-16";
  }, TypeError);

  for (const label of [
    "unicode-1-1-utf-8",
    "unicode11utf8",
    "unicode20utf8",
    "utf-8",
    "utf8",
    "x-unicode20utf8",
  ]) {
    assert.equal(new TextDecoder(label).encoding, "utf-8");
  }
  assert.equal(new TextDecoder("utf-8", null).fatal, false);
  for (const options of [0, false, "options", Symbol("options")]) {
    assert.throws(() => new TextDecoder("utf-8", options), TypeError);
  }
  assert.throws(() => new TextDecoder(null), RangeError);
  assert.throws(() => new TextDecoder(42), RangeError);
  assert.throws(() => new TextDecoder(Symbol("label")), TypeError);

  const failedOrder = [];
  assert.throws(
    () =>
      new TextDecoder("unsupported", {
        get fatal() {
          failedOrder.push("fatal");
          return false;
        },
        get ignoreBOM() {
          failedOrder.push("ignoreBOM");
          return false;
        },
      }),
    RangeError,
  );
  assert.deepEqual(failedOrder, ["fatal", "ignoreBOM"]);
});
test("TextDecoder accepts every AllowSharedBufferSource view without widening its range", () => {
  const buffer = Uint8Array.of(0x78, 0x61, 0x62, 0x79).buffer;
  assert.equal(new TextDecoder().decode(buffer), "xaby");
  assert.equal(new TextDecoder().decode(new DataView(buffer, 1, 2)), "ab");

  const wideBuffer = Uint8Array.of(0x78, 0x78, 0x61, 0x62, 0x79, 0x79).buffer;
  assert.equal(new TextDecoder().decode(new Uint16Array(wideBuffer, 2, 1)), "ab");

  const shared = new SharedArrayBuffer(4);
  new Uint8Array(shared).set([0x78, 0x61, 0x62, 0x79]);
  assert.equal(new TextDecoder().decode(new DataView(shared, 1, 2)), "ab");

  let optionsRead = false;
  assert.throws(
    () =>
      new TextDecoder().decode(
        {},
        {
          get stream() {
            optionsRead = true;
            return false;
          },
        },
      ),
    TypeError,
  );
  assert.equal(optionsRead, false);
  for (const input of [null, 42, {}, Symbol("input")]) {
    assert.throws(() => new TextDecoder().decode(input), TypeError);
  }
});
test("TextDecoder converts stream options before mutating decoder state", () => {
  const decoder = new TextDecoder();
  assert.equal(decoder.decode(Uint8Array.of(0xc2), { stream: "yes" }), "");
  assert.throws(() => decoder.decode(Uint8Array.of(0xa2), 1), TypeError);
  assert.equal(decoder.decode(Uint8Array.of(0xa2), { stream: 0 }), "¢");
  assert.equal(decoder.decode(undefined, null), "");

  const fatal = new TextDecoder("utf-8", { fatal: true });
  assert.equal(fatal.decode(Uint8Array.of(0x61), { stream: true }), "a");
  assert.throws(() => fatal.decode(Uint8Array.of(0xff), { stream: true }), TypeError);
  assert.equal(fatal.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x62), { stream: true }), "\ufeffb");
});
test("UTF-8 decoder differential over all split positions and malformed sequences", () => {
  const cases = [
    utf8.encode("A€💙\ufeffZ"),
    Uint8Array.of(0xef, 0xbb, 0xbf, 0x61),
    Uint8Array.of(0xe0, 0x80, 0x80),
    Uint8Array.of(0xf4, 0x90, 0x80, 0x80),
    Uint8Array.of(0xed, 0xa0, 0x80),
    Uint8Array.of(0xc2),
    Uint8Array.of(0xff, 0xc2, 0x41),
  ];
  for (const bytes of cases)
    for (let at = 0; at <= bytes.length; at++)
      for (const ignoreBOM of [false, true]) {
        const a = new TextDecoder("utf-8", { ignoreBOM }),
          b = new NativeDecoder("utf-8", { ignoreBOM });
        const left =
          a.decode(bytes.subarray(0, at), { stream: true }) + a.decode(bytes.subarray(at));
        const right =
          b.decode(bytes.subarray(0, at), { stream: true }) + b.decode(bytes.subarray(at));
        assert.equal(left, right);
      }
  assert.throws(
    () => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.of(0xff)),
    TypeError,
  );
});
test("UTF-8 seeded differential fuzz", () => {
  let seed = 0xdecafbad;
  for (let n = 0; n < 1000; n++) {
    const bytes = new Uint8Array(n % 71);
    for (let i = 0; i < bytes.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[i] = seed >>> 24;
    }
    assert.equal(new TextDecoder().decode(bytes), new NativeDecoder().decode(bytes));
  }
});
test("Abort reason identity and independent internal cancellation", () => {
  const controller = new AbortController();
  const reason = { kind: "test" };
  let calls = 0;
  controller.signal.addEventListener("abort", (event) => event.stopImmediatePropagation());
  controller.signal.subscribe(() => calls++);
  controller.abort(reason);
  controller.abort("later");
  assert.equal(controller.signal.reason, reason);
  assert.equal(calls, 1);
  assert.throws(
    () => controller.signal.throwIfAborted(),
    (error) => error === reason,
  );
});
test("Public EventTarget and abort constructors do not expose provider hooks", () => {
  assert.throws(() => new AbortSignal(), TypeError);
  assert.throws(() => new globalThis.AbortSignal(), TypeError);

  let reported = 0;
  const target = new EventTarget(() => reported++);
  target.addEventListener("error", () => {
    throw new Error("listener failure");
  });
  assert.equal(target.dispatchEvent(new Event("error")), true);

  const controller = new AbortController(() => reported++);
  controller.signal.subscribe(() => {
    throw new Error("abort failure");
  });
  controller.abort();
  assert.equal(reported, 0);
});
test("AbortSignal.any selects the first reason and detaches", () => {
  const a = new AbortController(),
    b = new AbortController();
  const combined = AbortSignal.any([a.signal, b.signal]);
  b.abort("b");
  a.abort("a");
  assert.equal(combined.reason, "b");
  assert.equal(AbortSignal.any([a.signal, b.signal]).reason, "a");
});
test("AbortSignal.any marks dependents before firing abort events", () => {
  const controller = new AbortController();
  const signals = [controller.signal];
  signals.push(AbortSignal.any([controller.signal]));
  signals.push(AbortSignal.any([controller.signal]));
  signals.push(AbortSignal.any([signals[0]]));
  signals.push(AbortSignal.any([signals[1]]));

  let order = "";
  for (let i = 0; i < signals.length; i++) {
    signals[i].addEventListener("abort", (event) => {
      assert.equal(event.isTrusted, true);
      for (const signal of signals) assert.equal(signal.aborted, true);
      order += i;
    });
  }
  controller.abort("first");
  assert.equal(order, "01234");
  for (const signal of signals) assert.equal(signal.reason, "first");
});
test("AbortSignal.any consumes iterables before observing their signals", () => {
  const first = new AbortController();
  const second = new AbortController();
  const signals = {
    *[Symbol.iterator]() {
      yield first.signal;
      first.abort("after first yield");
      yield second.signal;
    },
  };
  assert.equal(AbortSignal.any(signals).reason, "after first yield");
  assert.throws(() => AbortSignal.any([first.signal, {}]), TypeError);
});
test("AbortSignal.any retains only composites with active observers", async () => {
  const source = new AbortController();
  const unobserved = (() => {
    const signal = AbortSignal.any([source.signal]);
    return new WeakRef(signal);
  })();
  assert.equal(await collectWeakReference(unobserved), true);

  const removed = (() => {
    const signal = AbortSignal.any([source.signal]);
    const listener = () => {};
    signal.addEventListener("abort", listener);
    signal.removeEventListener("abort", listener);
    return new WeakRef(signal);
  })();
  assert.equal(await collectWeakReference(removed), true);

  const capability = Promise.withResolvers();
  const observed = (() => {
    const signal = AbortSignal.any([source.signal]);
    signal.addEventListener("abort", () => capability.resolve());
    return new WeakRef(signal);
  })();
  await tick();
  globalThis.gc();
  await tick();
  assert.notEqual(observed.deref(), undefined);
  source.abort();
  await capability.promise;
});
test("EventTarget once, receiver, removal while dispatching", () => {
  const target = new EventTarget();
  let calls = 0;
  const second = () => (calls += 100);
  target.addEventListener(
    "x",
    function () {
      assert.equal(this, target);
      calls++;
      target.removeEventListener("x", second);
    },
    { once: true },
  );
  target.addEventListener("x", second);
  target.dispatchEvent(new Event("x"));
  target.dispatchEvent(new Event("x"));
  assert.equal(calls, 1);
});
test("EventTarget fixes each dispatch boundary without retaining removed listeners", async () => {
  const target = new EventTarget();
  const calls = [];
  const late = () => calls.push("late");
  target.addEventListener("outer", () => {
    calls.push("outer");
    target.addEventListener("outer", late);
    target.dispatchEvent(new Event("nested"));
  });
  target.addEventListener("nested", () => calls.push("nested"));
  target.dispatchEvent(new Event("outer"));
  assert.deepEqual(calls, ["outer", "nested"]);
  target.dispatchEvent(new Event("outer"));
  assert.deepEqual(calls, ["outer", "nested", "outer", "nested", "late"]);

  const removed = (() => {
    const listener = () => {};
    target.addEventListener("removed", listener);
    target.removeEventListener("removed", listener);
    return new WeakRef(listener);
  })();
  assert.equal(await collectWeakReference(removed), true);
});
test("EventTarget listener objects resolve handleEvent at dispatch time", () => {
  for (const [EventClass, EventTargetClass] of [
    [Event, EventTarget],
    [globalThis.Event, globalThis.EventTarget],
  ]) {
    const calls = [];
    const target = new EventTargetClass();
    const listener = {
      handleEvent(event) {
        assert.equal(this, listener);
        calls.push("first:" + event.type);
      },
    };

    target.addEventListener("object", listener);
    target.addEventListener("object", listener);
    target.dispatchEvent(new EventClass("object"));
    listener.handleEvent = function (event) {
      assert.equal(this, listener);
      calls.push("second:" + event.type);
    };
    target.dispatchEvent(new EventClass("object"));
    target.removeEventListener("object", listener);
    target.dispatchEvent(new EventClass("object"));

    const callable = function () {
      calls.push("function");
    };
    callable.handleEvent = () => calls.push("wrong");
    target.addEventListener("function", callable);
    target.dispatchEvent(new EventClass("function"));
    assert.deepEqual(calls, ["first:object", "second:object", "function"]);
  }
});
test("EventTarget reads listener options with Web IDL timing", () => {
  const reads = [];
  const options = {
    get capture() {
      reads.push("capture");
      return false;
    },
    get once() {
      reads.push("once");
      return false;
    },
    get passive() {
      reads.push("passive");
      return false;
    },
    get signal() {
      reads.push("signal");
      return undefined;
    },
  };
  const target = new EventTarget();
  target.addEventListener("options", null, options);
  reads.push("remove");
  target.removeEventListener("options", null, options);

  assert.deepEqual(reads, ["capture", "once", "passive", "signal", "remove", "capture"]);
});
test("EventTarget converts type, callback and options before applying listener semantics", () => {
  const target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;
  const type = {
    toString() {
      return "converted";
    },
  };

  target.addEventListener(type, listener, null);
  target.dispatchEvent(new Event("converted"));
  assert.equal(calls, 1);
  target.removeEventListener(type, listener, null);
  target.dispatchEvent(new Event("converted"));
  assert.equal(calls, 1);

  target.addEventListener("ignored", undefined);
  target.addEventListener("scalar", listener, 1);
  target.removeEventListener("scalar", listener, true);
  target.dispatchEvent(new Event("scalar"));
  assert.equal(calls, 1);
  target.addEventListener("symbol", listener, Symbol("capture"));
  target.removeEventListener("symbol", listener, true);
  target.dispatchEvent(new Event("symbol"));
  assert.equal(calls, 1);
  assert.throws(() => target.addEventListener("missing"), TypeError);
  assert.throws(() => target.removeEventListener("missing"), TypeError);
  assert.throws(() => target.addEventListener("invalid", 1), TypeError);
  assert.throws(() => target.removeEventListener("invalid", 1), TypeError);
  target.addEventListener("ignored-scalar", null, 1);
  target.removeEventListener("ignored-scalar", null, 1);
  assert.throws(
    () =>
      target.addEventListener("forged-signal", listener, {
        signal: { aborted: false, subscribe() {} },
      }),
    TypeError,
  );
  assert.throws(() => target.dispatchEvent({}), TypeError);
});
test("EventTarget signal and passive listener options match Node", () => {
  const target = new EventTarget();
  const first = new AbortController();
  const duplicate = new AbortController();
  let calls = 0;
  const listener = () => calls++;

  target.addEventListener("signal", listener, { signal: first.signal });
  target.addEventListener("signal", listener, { signal: duplicate.signal });
  duplicate.abort();
  target.dispatchEvent(new Event("signal"));
  assert.equal(calls, 1);
  first.abort();
  target.dispatchEvent(new Event("signal"));
  assert.equal(calls, 1);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  target.addEventListener("signal", listener, { signal: alreadyAborted.signal });
  target.dispatchEvent(new Event("signal"));
  assert.equal(calls, 1);

  const duringDispatch = new AbortController();
  target.addEventListener("ordered", () => duringDispatch.abort());
  target.addEventListener("ordered", listener, { signal: duringDispatch.signal });
  target.dispatchEvent(new Event("ordered"));
  assert.equal(calls, 1);

  for (const [EventClass, EventTargetClass] of [
    [Event, EventTarget],
    [globalThis.Event, globalThis.EventTarget],
  ]) {
    const passiveTarget = new EventTargetClass();
    const event = new EventClass("passive", { cancelable: true });
    passiveTarget.addEventListener("passive", (current) => current.preventDefault(), {
      passive: true,
    });
    assert.equal(passiveTarget.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
  }

  const activeTarget = new EventTarget();
  const activeEvent = new Event("active", { cancelable: true });
  activeTarget.addEventListener("active", (event) => event.preventDefault());
  assert.equal(activeTarget.dispatchEvent(activeEvent), false);
  assert.equal(activeEvent.defaultPrevented, true);
});
test("Event exposes the DOM non-tree dispatch state machine", () => {
  for (const name of ["NONE", "CAPTURING_PHASE", "AT_TARGET", "BUBBLING_PHASE"])
    assert.equal(Event[name], globalThis.Event[name]);

  const target = new EventTarget();
  const event = new Event("state", { bubbles: true, cancelable: true, composed: true });
  assert.deepEqual(
    [event.NONE, event.CAPTURING_PHASE, event.AT_TARGET, event.BUBBLING_PHASE],
    [0, 1, 2, 3],
  );
  assert.equal(event.target, null);
  assert.equal(event.srcElement, null);
  assert.equal(event.currentTarget, null);
  assert.equal(event.eventPhase, Event.NONE);
  assert.deepEqual(event.composedPath(), []);
  assert.equal(event.cancelBubble, false);
  assert.equal(event.returnValue, true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.isTrusted, false);

  const calls = [];
  target.addEventListener("state", (current) => {
    calls.push("first");
    assert.equal(current.target, target);
    assert.equal(current.srcElement, target);
    assert.equal(current.currentTarget, target);
    assert.equal(current.eventPhase, Event.AT_TARGET);
    assert.deepEqual(current.composedPath(), [target]);
    current.stopPropagation();
    current.returnValue = false;
  });
  target.addEventListener("state", (current) => {
    calls.push("second");
    assert.equal(current.cancelBubble, true);
    assert.equal(current.returnValue, false);
  });

  assert.equal(target.dispatchEvent(event), false);
  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(event.target, target);
  assert.equal(event.srcElement, target);
  assert.equal(event.currentTarget, null);
  assert.equal(event.eventPhase, Event.NONE);
  assert.deepEqual(event.composedPath(), []);
  assert.equal(event.cancelBubble, false);
  assert.equal(event.returnValue, false);

  event.stopImmediatePropagation();
  event.initEvent("reset", false, false);
  assert.equal(event.type, "reset");
  assert.equal(event.bubbles, false);
  assert.equal(event.cancelable, false);
  assert.equal(event.composed, true);
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.cancelBubble, false);
  assert.equal(event.target, null);

  const blocked = new Event("blocked");
  let blockedCalls = 0;
  target.addEventListener("blocked", () => blockedCalls++);
  blocked.stopImmediatePropagation();
  target.dispatchEvent(blocked);
  assert.equal(blockedCalls, 0);
  assert.equal(blocked.cancelBubble, false);
  target.dispatchEvent(blocked);
  assert.equal(blockedCalls, 1);

  const inFlight = new Event("in-flight", { bubbles: true, cancelable: true });
  target.addEventListener("in-flight", (current) => {
    current.initEvent("ignored", false, false);
    assert.equal(current.type, "in-flight");
    assert.equal(current.bubbles, true);
    assert.equal(current.cancelable, true);
  });
  target.dispatchEvent(inFlight);
});
test("CustomEvent preserves detail and ignores legacy initialization during dispatch", () => {
  for (const CustomEventClass of [CustomEvent, NativeCustomEvent]) {
    const marker = { marker: true };
    const event = new CustomEventClass("before", {
      bubbles: true,
      cancelable: false,
      detail: marker,
    });
    assert.equal(event.detail, marker);
    assert.equal(new CustomEventClass("empty").detail, null);
  }

  const marker = { marker: true };
  const event = new CustomEvent("before", { bubbles: true, detail: marker });
  const target = new EventTarget();
  target.addEventListener("before", () => {
    event.initCustomEvent("ignored", false, true, "ignored");
  });
  target.dispatchEvent(event);
  assert.deepEqual(
    [event.type, event.bubbles, event.cancelable, event.detail],
    ["before", true, false, marker],
  );

  event.initCustomEvent("after", false, true, "changed");
  assert.deepEqual(
    [event.type, event.bubbles, event.cancelable, event.detail],
    ["after", false, true, "changed"],
  );
});
test("Event subclasses apply Web IDL value and readonly-state semantics", () => {
  for (const [value, expected] of [
    [NaN, 0],
    [Infinity, 0],
    [-Infinity, 0],
    [-1, 65_535],
    [-0.5, 0],
    [1.9, 1],
    [65_535, 65_535],
    [65_536, 0],
    [65_537, 1],
  ]) {
    const event = new CloseEvent("close", { code: value });
    assert.equal(event.code, expected, String(value));
    assert.equal(Object.is(event.code, -0), false, String(value));
  }

  const close = new CloseEvent("close", { code: 1000, reason: "\ud800", wasClean: true });
  const nativeClose = new globalThis.CloseEvent("close", {
    code: 1000,
    reason: "\ud800",
    wasClean: true,
  });
  assert.deepEqual(
    [close.code, close.reason, close.wasClean],
    [nativeClose.code, nativeClose.reason, nativeClose.wasClean],
  );
  assert.throws(() => {
    close.code = 1001;
  }, TypeError);

  const port = new EventTarget();
  const marker = { marker: true };
  const message = new MessageEvent("before", {
    data: marker,
    origin: "\ud800",
    ports: [port],
    source: port,
  });
  assert.deepEqual(
    [message.data, message.origin, message.lastEventId, message.source, ...message.ports],
    [marker, "�", "", port, port],
  );
  const target = new EventTarget();
  target.addEventListener("before", () => {
    message.initMessageEvent("ignored", false, true, null, "ignored");
  });
  target.dispatchEvent(message);
  assert.equal(message.type, "before");
  assert.equal(message.data, marker);

  const nextPorts = [new EventTarget()];
  message.initMessageEvent("after", false, true, "data", "origin", "last", null, nextPorts);
  nextPorts.length = 0;
  assert.deepEqual(
    [message.type, message.bubbles, message.cancelable, message.data, message.origin],
    ["after", false, true, "data", "origin"],
  );
  assert.equal(message.lastEventId, "last");
  assert.equal(message.source, null);
  assert.equal(message.ports.length, 1);
  assert.throws(() => {
    message.data = null;
  }, TypeError);

  const error = new ErrorEvent("error", {
    colno: 4_294_967_297,
    filename: "\ud800",
    lineno: -1,
  });
  assert.deepEqual(
    [error.colno, error.error, error.filename, error.lineno, error.message],
    [1, undefined, "�", 4_294_967_295, ""],
  );
  assert.throws(() => {
    error.lineno = 1;
  }, TypeError);
});
test("Pull streams honor locking and do not prefetch at zero HWM", async () => {
  let pulls = 0;
  const stream = new ReadableStream(
    {
      pull(c) {
        pulls++;
        c.enqueue(1);
        c.close();
      },
    },
    { highWaterMark: 0 },
  );
  await tick();
  assert.equal(pulls, 0);
  const reader = stream.getReader();
  assert.throws(() => stream.getReader());
  assert.deepEqual(await reader.read(), { done: false, value: 1 });
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  reader.releaseLock();
  assert.equal(stream.locked, false);
  assert.equal(pulls, 1);
});
test("Built-in queuing strategies preserve Web IDL conversion and function identity", () => {
  for (const [Actual, Expected] of [
    [CountQueuingStrategy, globalThis.CountQueuingStrategy],
    [ByteLengthQueuingStrategy, globalThis.ByteLengthQueuingStrategy],
  ]) {
    for (const input of [-Infinity, -5, false, true, NaN, "foo", "0", {}, () => {}]) {
      const actual = new Actual({ highWaterMark: input });
      const expected = new Expected({ highWaterMark: input });
      assert.deepEqual(
        [actual.highWaterMark, Object.prototype.toString.call(actual)],
        [expected.highWaterMark, Object.prototype.toString.call(expected)],
      );
    }

    const first = new Actual({ highWaterMark: 1 });
    const second = new Actual({ highWaterMark: 2 });
    assert.equal(first.size, second.size);
    assert.equal(first.size.name, "size");
    assert.equal(first.size.length, new Expected({ highWaterMark: 1 }).size.length);
    assert.equal("prototype" in first.size, false);

    for (const property of ["highWaterMark", "size"]) {
      const getter = Object.getOwnPropertyDescriptor(Actual.prototype, property).get;
      assert.throws(() => getter.call({}), TypeError);
    }
  }

  assert.equal(new CountQueuingStrategy({ highWaterMark: 1 }).size(), 1);
  assert.equal(new ByteLengthQueuingStrategy({ highWaterMark: 1 }).size(new Uint8Array(7)), 7);
  assert.throws(() => new CountQueuingStrategy(), TypeError);
  assert.throws(() => new ByteLengthQueuingStrategy(null), TypeError);
});
test("Writable streams serialize writes and expose exact backpressure epochs", async () => {
  const releases = [];
  const writes = [];
  const stream = new WritableStream(
    {
      write(chunk, controller) {
        assert.equal(controller.signal.aborted, false);
        writes.push(chunk);
        const release = Promise.withResolvers();
        releases.push(release);
        return release.promise;
      },
    },
    { highWaterMark: 2 },
  );
  const writer = stream.getWriter();
  const initiallyReady = writer.ready;
  assert.equal(writer.desiredSize, 2);

  const first = writer.write("a");
  assert.equal(writer.desiredSize, 1);
  assert.deepEqual(writes, []);
  await initiallyReady;
  await Promise.resolve();
  assert.deepEqual(writes, ["a"]);

  const second = writer.write("b");
  const backpressured = writer.ready;
  assert.equal(writer.desiredSize, 0);
  assert.notEqual(backpressured, initiallyReady);
  assert.deepEqual(writes, ["a"]);

  releases[0].resolve();
  await first;
  assert.deepEqual(writes, ["a", "b"]);
  assert.equal(writer.desiredSize, 1);
  await backpressured;
  releases[1].resolve();
  await second;
  await writer.close();
  await writer.closed;
  assert.equal(writer.desiredSize, 0);
});
test("Writable operations expose their Web IDL arity and accept an omitted chunk", async () => {
  assert.equal(WritableStream.prototype.abort.length, 0);
  assert.equal(WritableStreamDefaultWriter.prototype.abort.length, 0);
  assert.equal(WritableStreamDefaultWriter.prototype.write.length, 0);
  assert.equal(WritableStreamDefaultController.prototype.error.length, 0);

  const chunks = [];
  const writer = new WritableStream({ write: (chunk) => chunks.push(chunk) }).getWriter();
  await writer.write();
  assert.deepEqual(chunks, [undefined]);
  await writer.close();
});
test("Writable stream abort owns the sink signal and preserves reason identity", async () => {
  const reason = new Error("stop");
  let controller;
  let receivedReason;
  const stream = new WritableStream({
    start(value) {
      controller = value;
    },
    abort(value) {
      receivedReason = value;
    },
  });
  const writer = stream.getWriter();
  const closed = writer.closed;
  await writer.abort(reason);
  await assert.rejects(closed, (error) => error === reason);
  assert.equal(receivedReason, reason);
  assert.equal(controller.signal.aborted, true);
  assert.equal(controller.signal.reason, reason);
  assert.equal(writer.desiredSize, null);
});
test("Writable terminal states release captured sink and strategy algorithms", async () => {
  const fixture = (() => {
    const sink = {};
    const size = () => 1;
    const stream = new WritableStream(sink, { size });
    return {
      stream,
      writer: stream.getWriter(),
      sinkReference: new WeakRef(sink),
      sizeReference: new WeakRef(size),
    };
  })();

  await fixture.writer.close();
  assert.equal(await collectWeakReference(fixture.sinkReference), true);
  assert.equal(await collectWeakReference(fixture.sizeReference), true);
  assert.equal(fixture.stream.locked, true);
});
test("Writable setup releases its transient start algorithm", async () => {
  let startReference;
  const sink = {
    get start() {
      const start = () => {};
      startReference = new WeakRef(start);
      return start;
    },
  };
  const writer = new WritableStream(sink).getWriter();

  await Promise.resolve();
  assert.ok(startReference);
  assert.equal(await collectWeakReference(startReference), true);
  await writer.close();
});
test("Writable queues release consumed chunks before later writes settle", async () => {
  const releases = [];
  const writer = new WritableStream({
    write() {
      const release = Promise.withResolvers();
      releases.push(release);
      return release.promise;
    },
  }).getWriter();
  const fixture = (() => {
    const firstChunk = {};
    return {
      firstChunkReference: new WeakRef(firstChunk),
      firstWrite: writer.write(firstChunk),
      secondWrite: writer.write({}),
    };
  })();

  await Promise.resolve();
  releases[0].resolve();
  await fixture.firstWrite;
  await Promise.resolve();
  assert.equal(releases.length, 2);
  assert.equal(await collectWeakReference(fixture.firstChunkReference), true);

  releases[1].resolve();
  await fixture.secondWrite;
  await writer.close();
});
test("Stream cancellation settles pending read even while underlying pull awaits", async () => {
  let canceled = false;
  const stream = new ReadableStream(
    {
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        canceled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const reader = stream.getReader();
  const pending = reader.read();
  await reader.cancel("stop");
  assert.deepEqual(await pending, { done: true, value: undefined });
  assert.equal(canceled, true);
});
test("Stream strategy callbacks have no receiver and pending reads remain FIFO", async () => {
  let controller;
  let sizeReceiver = "not-called";
  const stream = new ReadableStream(
    {
      start(value) {
        controller = value;
      },
    },
    {
      highWaterMark: 0,
      size() {
        sizeReceiver = this;
        return 1;
      },
    },
  );
  const reader = stream.getReader();
  const reads = new Array(2050);
  for (let index = 0; index < reads.length; index++) {
    reads[index] = reader.read();
  }
  for (let index = 0; index < reads.length; index++) {
    controller.enqueue(index);
  }
  controller.close();
  const results = await Promise.all(reads);
  for (let index = 0; index < results.length; index++) {
    assert.deepEqual(results[index], { done: false, value: index });
  }
  assert.equal(sizeReceiver, "not-called");
  assert.deepEqual(await reader.read(), { done: true, value: undefined });

  let bufferedController;
  const buffered = new ReadableStream(
    {
      start(value) {
        bufferedController = value;
        value.enqueue(1e-16);
        value.enqueue(1);
      },
    },
    {
      size(value) {
        sizeReceiver = this;
        return value;
      },
    },
  );
  assert.equal(sizeReceiver, undefined);
  const bufferedReader = buffered.getReader();
  assert.deepEqual(await bufferedReader.read(), { done: false, value: 1e-16 });
  assert.deepEqual(await bufferedReader.read(), { done: false, value: 1 });
  assert.equal(bufferedController.desiredSize, 1);
  bufferedController.close();
  assert.deepEqual(await bufferedReader.read(), { done: true, value: undefined });
});
test("Stream queue and pending-read compaction preserve long FIFO order", async () => {
  const queued = new ReadableStream(
    {
      start(controller) {
        for (let value = 0; value < 2_050; value++) controller.enqueue(value);
        controller.close();
      },
    },
    { highWaterMark: 2_050 },
  );
  const queuedReader = queued.getReader();
  for (let value = 0; value < 2_050; value++) {
    assert.deepEqual(await queuedReader.read(), { done: false, value });
  }
  assert.deepEqual(await queuedReader.read(), { done: true, value: undefined });

  let controller;
  const pending = new ReadableStream(
    {
      start(current) {
        controller = current;
      },
    },
    { highWaterMark: 0 },
  );
  const pendingReader = pending.getReader();
  const reads = [];
  for (let value = 0; value < 2_050; value++) reads.push(pendingReader.read());
  for (let value = 0; value < 2_050; value++) controller.enqueue(value);
  controller.close();
  const results = await Promise.all(reads);
  for (let value = 0; value < results.length; value++) {
    assert.deepEqual(results[value], { done: false, value });
  }
  assert.deepEqual(await pendingReader.read(), { done: true, value: undefined });
});
test("Tee validates the explicit backlog limit before locking its source", () => {
  for (const limit of [-1, NaN]) {
    const source = new ReadableStream();
    assert.throws(() => tee(source, { maxBufferedSize: limit }), RangeError);
    assert.equal(source.locked, false);
  }
});
test("Tee observes terminal source state without a branch read", async () => {
  let closeController;
  const closing = new ReadableStream(
    {
      start(controller) {
        closeController = controller;
      },
    },
    { highWaterMark: 0 },
  );
  const [closedA, closedB] = closing.tee();
  const closedReaderA = closedA.getReader();
  const closedReaderB = closedB.getReader();
  closeController.close();
  await Promise.all([closedReaderA.closed, closedReaderB.closed]);
  assert.equal(closing.locked, true);

  let errorController;
  const erroring = new ReadableStream(
    {
      start(controller) {
        errorController = controller;
      },
    },
    { highWaterMark: 0 },
  );
  const [erroredA, erroredB] = erroring.tee();
  const erroredReader = erroredA.getReader();
  errorController.enqueue("queued before failure");
  await tick();
  const canceled = erroredB.cancel("unused");
  const failure = new Error("source failed");
  errorController.error(failure);
  await assert.rejects(erroredReader.closed, (error) => error === failure);
  await assert.rejects(erroredReader.read(), (error) => error === failure);
  await canceled;
  assert.equal(erroring.locked, true);
});
test("Body use, locking, transfer, clone and canonical identity", async () => {
  const response = makeResponse("hello");
  const clone = response.clone();
  assert.ok(clone instanceof Response);
  assert.equal(response.bodyUsed, false);
  const reader = response.body.getReader();
  assert.equal(response.bodyUsed, false);
  assert.throws(() => response.clone());
  await assert.rejects(response.text());
  reader.releaseLock();
  assert.deepEqual(await Promise.all([response.text(), clone.text()]), ["hello", "hello"]);
  await assert.rejects(response.text());
  const request = makeRequest("http://example.test", { method: "POST", body: "x" });
  const requestClone = request.clone();
  assert.ok(requestClone instanceof Request);
  const transferred = makeRequest(request);
  assert.equal(request.bodyUsed, true);
  assert.equal(request.body.locked, true);
  assert.equal(await transferred.text(), "x");
  assert.equal(await requestClone.text(), "x");
});
test("A null body stays unused after repeated consumption", async () => {
  const response = makeResponse();
  assert.equal(await response.text(), "");
  assert.equal(await response.text(), "");
  assert.equal(response.bodyUsed, false);
});
test("Cloned byte streams are isolated from mutation", async () => {
  const r = makeResponse(Uint8Array.of(1, 2, 3));
  const clone = r.clone();
  const a = r.body.getReader(),
    b = clone.body.getReader();
  const first = await a.read();
  first.value[0] = 9;
  assert.deepEqual((await b.read()).value, Uint8Array.of(1, 2, 3));
  await Promise.all([a.cancel(), b.cancel()]);
});
test("Explicit clone backlog cap errors rather than silently buffering indefinitely", async () => {
  const [a, b] = tee(bytesStream(Uint8Array.of(1, 2, 3, 4), 2), {
    maxBufferedSize: 2,
    size: (x) => x.length,
    clone: (x) => x.slice(),
  });
  const reader = a.getReader();
  assert.deepEqual((await reader.read()).value, Uint8Array.of(1, 2));
  await assert.rejects(reader.read(), /Clone backlog/);
  await assert.rejects(b.getReader().read(), /Clone backlog/);
});
test("Request method, credentials URL, GET body and stream duplex validation", () => {
  assert.equal(makeRequest("http://example.test", { method: "post" }).method, "POST");
  assert.equal(makeRequest("http://example.test", { method: "patch" }).method, "patch");
  for (const method of ["TRACE", "track", "CONNECT", "bad method"])
    assert.throws(() => makeRequest("http://example.test", { method }));
  assert.throws(() => makeRequest("http://user:pass@example.test"));
  assert.throws(() => makeRequest("http://example.test", { body: "x" }));
  assert.throws(
    () => makeRequest("http://example.test", { method: "POST", body: new ReadableStream() }),
    /duplex/,
  );
});
test("Request converts its Web IDL arguments and dictionary in observable order", async () => {
  for (const input of [42, true, null, undefined]) {
    assert.throws(() => makeRequest(input), undefined, String(input));
    assert.throws(() => new NativeRequest(input), undefined, String(input));
  }
  const convertedInput = { toString: () => "http://example.test/x" };
  assert.equal(makeRequest(convertedInput).url, new NativeRequest(convertedInput).url);
  assert.throws(() => makeRequest(Symbol("input")));

  for (const method of [42, true, null, { toString: () => "custom" }]) {
    const actual = makeRequest("http://example.test", { method });
    const expected = new NativeRequest("http://example.test", { method });
    assert.equal(actual.method, expected.method, String(method));
  }
  for (const method of ["\u00e9", "\u20ac", Symbol("method")]) {
    assert.throws(() => makeRequest("http://example.test", { method }), undefined, String(method));
  }
  assert.throws(() => makeRequest("http://example.test", 1));
  assert.equal(makeRequest("http://example.test", null).method, "GET");

  const order = [];
  const request = makeRequest(
    {
      toString() {
        order.push("input");
        return "http://example.test";
      },
    },
    {
      get body() {
        order.push("body");
        return {
          toString() {
            order.push("body conversion");
            return "payload";
          },
        };
      },
      get credentials() {
        order.push("credentials");
        return undefined;
      },
      get duplex() {
        order.push("duplex");
        return "half";
      },
      get headers() {
        order.push("headers");
        return (function* () {
          order.push("header iteration");
          yield ["x-order", "1"];
        })();
      },
      get method() {
        order.push("method");
        return "POST";
      },
      get redirect() {
        order.push("redirect");
        return undefined;
      },
      get signal() {
        order.push("signal");
        return undefined;
      },
    },
  );
  assert.deepEqual(order, [
    "input",
    "body",
    "body conversion",
    "credentials",
    "duplex",
    "headers",
    "header iteration",
    "method",
    "redirect",
    "signal",
  ]);
  assert.equal(await request.text(), "payload");
  assert.equal(request.headers.get("content-type"), "text/plain;charset=UTF-8");
});
test("Response static factories, immutable redirects, JSON and no-content statuses", async () => {
  const r = Response.json({ ok: true });
  assert.ok(r instanceof Response);
  assert.deepEqual(await r.json(), { ok: true });
  const error = Response.error();
  assert.ok(error instanceof Response);
  assert.equal(error.status, 0);
  assert.equal(error.type, "error");
  const redirect = makeRedirectResponse("https://example.test/");
  assert.ok(redirect instanceof Response);
  assert.equal(redirect.status, 302);
  assert.throws(() => redirect.headers.set("a", "b"));
  for (const status of [204, 205, 304]) assert.throws(() => makeResponse("", { status }));
});
test("Response applies Web IDL conversion before validation and body extraction", async () => {
  for (const input of [200.9, "201", 65_536 + 204, 65_536 + 599]) {
    const actual = makeResponse(null, { status: input });
    const expected = new NativeResponse(null, { status: input });
    assert.equal(actual.status, expected.status, String(input));
  }
  for (const input of [null, NaN, Infinity, -1, 199.9, 65_536 + 199]) {
    assert.throws(() => makeResponse(null, { status: input }), undefined, String(input));
  }

  for (const input of [42, true, null, { toString: () => "Reason" }]) {
    const actual = makeResponse(null, { statusText: input });
    const expected = new NativeResponse(null, { statusText: input });
    assert.equal(actual.statusText, expected.statusText, String(input));
  }
  for (const input of ["\u20ac", Symbol("status")]) {
    assert.throws(() => makeResponse(null, { statusText: input }), undefined, String(input));
  }

  for (const input of [42, true, 1n, { toString: () => "object body" }]) {
    const actual = makeResponse(input);
    const expected = new NativeResponse(input);
    assert.equal(await actual.text(), await expected.text(), String(input));
    assert.equal(actual.headers.get("content-type"), expected.headers.get("content-type"));
  }
  assert.throws(() => makeResponse(Symbol("body")));
  assert.throws(() => makeResponse(null, 1));
  assert.equal(makeResponse(null, null).status, 200);

  const order = [];
  const response = makeResponse(
    {
      toString() {
        order.push("body");
        return "payload";
      },
    },
    {
      get headers() {
        order.push("headers");
        return (function* () {
          order.push("header iteration");
          yield ["x-order", "1"];
        })();
      },
      get status() {
        order.push("status");
        return 201;
      },
      get statusText() {
        order.push("statusText");
        return "Created";
      },
    },
  );
  assert.deepEqual(order, ["body", "headers", "header iteration", "status", "statusText"]);
  assert.equal(await response.text(), "payload");
});
test("Blob immutability, slices, File and form serialization", async () => {
  const bytes = Uint8Array.of(1, 2, 3);
  const blob = new Blob([bytes]);
  bytes[0] = 9;
  assert.deepEqual(await blob.bytes(), Uint8Array.of(1, 2, 3));
  const exposed = await blob.stream().getReader().read();
  exposed.value[0] = 7;
  assert.deepEqual(await blob.bytes(), Uint8Array.of(1, 2, 3));
  assert.deepEqual(await blob.slice(-2).bytes(), Uint8Array.of(2, 3));
  const form = new FormData();
  form.append("hello", "a\nb");
  form.append("file", new File(["hello"], "hello.txt", { type: "text/plain", lastModified: 0 }));
  const encoded = encodeMultipart(form, {
    fill(bytes) {
      bytes.fill(1);
    },
  });
  const text = await encoded.blob.text();
  assert.match(text, /name="hello"\r\n\r\na\r\nb\r\n/);
  assert.match(text, /filename="hello.txt"/);
  assert.equal(utf8.encode(text).length, encoded.blob.size);
  assert.match(encoded.contentType, /boundary=----nts-/);
});
test("FormData applies Web IDL overload conversion and preserves renamed files", () => {
  const actual = new FormData();
  const expected = new NativeFormData();
  for (const form of [actual, expected]) {
    form.append(1, true);
    form.append("object", { value: 1 });
    form.append("null", null);
    form.append("undefined", undefined);
    form.set(false, 0);
  }
  assert.deepEqual([...actual], [...expected]);
  assert.equal(actual.get(1), expected.get(1));
  assert.equal(actual.has(false), expected.has(false));

  const file = new File(["body"], "old", { type: "text/plain", lastModified: 123 });
  const nativeFile = new NativeFile(["body"], "old", {
    type: "text/plain",
    lastModified: 123,
  });
  actual.append("renamed", file, 42);
  expected.append("renamed", nativeFile, 42);
  const renamed = actual.get("renamed");
  const nativeRenamed = expected.get("renamed");
  assert.equal(renamed.name, nativeRenamed.name);
  assert.equal(renamed.type, nativeRenamed.type);
  assert.equal(renamed.lastModified, nativeRenamed.lastModified);
  assert.notEqual(renamed, file);
  assert.throws(() => actual.append("bad", "text", "filename"), TypeError);
  assert.throws(() => actual.append("bad", "text", undefined), TypeError);

  actual.append("blob", new Blob(["body"]), undefined);
  expected.append("blob", new NativeBlob(["body"]), undefined);
  assert.equal(actual.get("blob").name, expected.get("blob").name);
});
test("FormData enforces required arguments before conversion", () => {
  const actual = new FormData();
  const expected = new NativeFormData();
  for (const operation of ["append", "set"]) {
    assert.throws(() => actual[operation](), TypeError);
    assert.throws(() => actual[operation]("name"), TypeError);
    assert.throws(() => expected[operation](), TypeError);
    assert.throws(() => expected[operation]("name"), TypeError);
  }
  for (const operation of ["delete", "get", "getAll", "has"]) {
    assert.throws(() => actual[operation](), TypeError);
    assert.throws(() => expected[operation](), TypeError);
  }

  actual.append(undefined, undefined);
  expected.append(undefined, undefined);
  assert.deepEqual([...actual], [...expected]);

  const actualOrder = [];
  const expectedOrder = [];
  const makeValue = (order, label) => ({
    toString() {
      order.push(label);
      return label;
    },
  });
  assert.throws(
    () =>
      actual.append(
        makeValue(actualOrder, "name"),
        makeValue(actualOrder, "value"),
        makeValue(actualOrder, "filename"),
      ),
    TypeError,
  );
  assert.throws(
    () =>
      expected.append(
        makeValue(expectedOrder, "name"),
        makeValue(expectedOrder, "value"),
        makeValue(expectedOrder, "filename"),
      ),
    TypeError,
  );
  assert.deepEqual(actualOrder, expectedOrder);
});
test("FormData validates callbacks before iteration and keeps iteration live", () => {
  const empty = new FormData();
  assert.throws(() => empty.forEach(null), TypeError);

  const actual = new FormData();
  const expected = new NativeFormData();
  for (const form of [actual, expected]) {
    form.append("first", "1");
    form.append("second", "2");
  }
  const actualEntries = [];
  const expectedEntries = [];
  actual.forEach(function (value, name, parent) {
    actualEntries.push([name, value, this, parent === actual]);
    if (name === "first") parent.append("third", "3");
  }, "receiver");
  expected.forEach(function (value, name, parent) {
    expectedEntries.push([name, value, this, parent === expected]);
    if (name === "first") parent.append("third", "3");
  }, "receiver");
  assert.deepEqual(actualEntries, expectedEntries);
  assert.equal(Object.prototype.toString.call(actual), "[object FormData]");
  assert.deepEqual(Object.keys(actual), Object.keys(expected));

  const iterators = [actual.entries(), actual.keys(), actual.values(), actual[Symbol.iterator]()];
  const iteratorPrototype = Object.getPrototypeOf(iterators[0]);
  for (const iterator of iterators) {
    assert.equal(Object.getPrototypeOf(iterator), iteratorPrototype);
    assert.equal(Object.prototype.toString.call(iterator), "[object FormData Iterator]");
    assert.equal(iterator[Symbol.iterator](), iterator);
    assert.equal(iterator.return, undefined);
    assert.equal(iterator.throw, undefined);
    assert.deepEqual(Object.keys(iterator), []);
  }
  assert.deepEqual(
    actual
      .entries()
      .map(([name]) => name)
      .toArray(),
    [...actual.keys()],
  );
  const actualShape = actual.entries();
  const expectedShape = expected.entries();
  assert.deepEqual(Object.keys(actualShape.next()), Object.keys(expectedShape.next()));
  for (const _entry of actualShape) {
    // Consume the same live iterator to its terminal result.
  }
  for (const _entry of expectedShape) {
    // Consume the native oracle to the same terminal result.
  }
  assert.deepEqual(Object.keys(actualShape.next()), Object.keys(expectedShape.next()));

  const growingActual = new FormData();
  const growingExpected = new NativeFormData();
  const growingActualIterator = growingActual.entries();
  const growingExpectedIterator = growingExpected.entries();
  assert.deepEqual(growingActualIterator.next(), growingExpectedIterator.next());
  growingActual.append("late", "value");
  growingExpected.append("late", "value");
  assert.deepEqual(growingActualIterator.next(), growingExpectedIterator.next());
  assert.throws(() => iterators[0].next.call({}), TypeError);

  const yielded = actual.entries().next().value;
  yielded[1] = "not stored";
  assert.equal(actual.get("first"), "1");
  assert.throws(() => FormData.prototype.get.call({}, "name"), TypeError);
  assert.throws(() => FormData.prototype.append.call({}, "name", "value"), TypeError);
  assert.throws(() => FormData.prototype.entries.call({}), TypeError);
  assert.throws(() => FormData.prototype.forEach.call({}, () => {}), TypeError);
});
test("FormData obtains generated File timestamps from its owning environment", () => {
  const installedRuntime = globalThis.nts_environment_platform;
  const expectedTime = 1_234_567_890;
  globalThis.nts_environment_platform = () => ({
    wallTimeMilliseconds() {
      return expectedTime;
    },
  });
  try {
    const form = new FormData();
    form.append("blob", new Blob());
    assert.equal(form.get("blob").lastModified, expectedTime);
  } finally {
    globalThis.nts_environment_platform = installedRuntime;
  }
});
test("Blob copies every view and applies Web IDL slice conversion", async () => {
  const backing = Uint8Array.of(9, 1, 2, 3, 9);
  const view = new DataView(backing.buffer, 1, 3);
  const blob = new Blob([view]);
  backing.fill(7);
  assert.deepEqual(await blob.bytes(), Uint8Array.of(1, 2, 3));

  const returned = new Uint8Array(await blob.arrayBuffer());
  returned.fill(8);
  assert.deepEqual(await blob.bytes(), Uint8Array.of(1, 2, 3));

  const actual = new Blob(["hello"]);
  const expected = new NativeBlob(["hello"]);
  for (const value of [NaN, -Infinity, -1.5, -0.5, 0.1, 0.5, 1.4, 1.5, 1.6, 2.5, Infinity]) {
    assert.equal(actual.slice(0, value).size, expected.slice(0, value).size, String(value));
    assert.equal(actual.slice(value).size, expected.slice(value).size, String(value));
  }

  assert.equal(new File([], "name", { lastModified: NaN }).lastModified, 0);
  assert.equal(new NativeFile([], "name", { lastModified: NaN }).lastModified, 0);
});
test("Blob consumes its iterable once and decodes across immutable chunk boundaries", async () => {
  let iterations = 0;
  const parts = {
    *[Symbol.iterator]() {
      iterations++;
      yield Uint8Array.of(0xe2);
      yield Uint8Array.of(0x82);
      yield Uint8Array.of(0xac);
      yield "!";
    },
  };
  const blob = new Blob(parts);
  assert.equal(iterations, 1);
  assert.equal(blob.size, 4);
  assert.equal(await blob.text(), "€!");
  assert.equal(iterations, 1);
});
test("Blob and File apply their complete Web IDL constructor boundaries", async () => {
  assert.equal(Blob.length, 0);
  assert.equal(String(new Blob()), "[object Blob]");
  assert.equal(String(new File([], "name")), "[object File]");

  for (const input of [null, true, 1, "abc", {}, new Date()]) {
    assert.throws(() => new Blob(input), TypeError);
  }
  for (const options of [true, 1, "abc"]) {
    assert.throws(() => new Blob([], options), TypeError);
    assert.throws(() => new File([], "name", options), TypeError);
  }

  const trace = [];
  const part = {
    toString() {
      trace.push("part");
      return "\ud800";
    },
  };
  const name = {
    toString() {
      trace.push("name");
      return "file-\ud800";
    },
  };
  const options = {};
  for (const [member, value] of [
    ["endings", "transparent"],
    ["type", "TEXT/PLAIN"],
    ["lastModified", 9.9],
  ]) {
    Object.defineProperty(options, member, {
      get() {
        trace.push(member);
        return value;
      },
    });
  }
  const file = new File([part], name, options);
  assert.deepEqual(trace, ["part", "name", "endings", "type", "lastModified"]);
  assert.equal(await file.text(), "�");
  assert.equal(file.name, "file-�");
  assert.equal(file.type, "text/plain");
  assert.equal(file.lastModified, 9);

  assert.throws(() => new File(), TypeError);
  assert.throws(() => new File([]), TypeError);
  assert.equal(new File([], undefined).name, "undefined");
  assert.equal(new File([], "name", { lastModified: NaN }).lastModified, 0);
  assert.equal(new File([], "name", { lastModified: Infinity }).lastModified, 0);
  assert.equal(new File([], "name", { lastModified: 2 ** 64 }).lastModified, 0);
  assert.equal(new File([], "name", { lastModified: 2 ** 63 }).lastModified, -(2 ** 63));
  assert.throws(() => new File([], "name", { lastModified: 1n }), TypeError);
});
test("Blob converts options after parts and copies buffer sources afterwards", async () => {
  const trace = [];
  const bytes = Uint8Array.of(1, 2, 3);
  const parts = {
    *[Symbol.iterator]() {
      trace.push("parts");
      yield bytes;
      yield {
        toString() {
          trace.push("string");
          return "x";
        },
      };
    },
  };
  const options = {};
  Object.defineProperties(options, {
    endings: {
      get() {
        trace.push("endings");
        bytes[0] = 9;
        return "transparent";
      },
    },
    type: {
      get() {
        trace.push("type");
        return null;
      },
    },
  });

  const blob = new Blob(parts, options);
  bytes.fill(7);
  assert.deepEqual(trace, ["parts", "string", "endings", "type"]);
  assert.equal(blob.type, "null");
  assert.deepEqual(await blob.bytes(), Uint8Array.of(9, 2, 3, 120));

  const shared = new SharedArrayBuffer(5);
  new Uint8Array(shared).set([8, 1, 2, 3, 8]);
  const sharedBlob = new Blob([new DataView(shared, 1, 3), shared]);
  new Uint8Array(shared).fill(0);
  assert.deepEqual(await sharedBlob.bytes(), Uint8Array.of(1, 2, 3, 8, 1, 2, 3, 8));

  assert.throws(() => new Blob([], { endings: "invalid" }), TypeError);
  assert.equal(new Blob([], { type: "A\u001fB" }).type, "");
  assert.equal(new Blob([], { type: null }).type, "null");
});
test("Blob native endings and slice arguments use provider and Web IDL conversion", async () => {
  const normalized = new Blob(["a\rb\r\nc\nd"], { endings: "native" });
  assert.equal(await normalized.text(), ["a", "b", "c", "d"].join(api.nativeLineEnding));

  const trace = [];
  const value = new Blob(["abcdef"]);
  const sliced = value.slice(
    {
      valueOf() {
        trace.push("start");
        return 1.5;
      },
    },
    {
      valueOf() {
        trace.push("end");
        return 4.5;
      },
    },
    {
      toString() {
        trace.push("type");
        return "TEXT/PLAIN";
      },
    },
  );
  assert.deepEqual(trace, ["start", "end", "type"]);
  assert.equal(await sliced.text(), "cd");
  assert.equal(sliced.type, "text/plain");
  assert.equal(value.slice(0, 0, null).type, "null");
  assert.throws(() => value.slice(0, 0, Symbol("type")), TypeError);
});
test("Blob provider storage reopens exact ranges and composes without materializing", async () => {
  const bytes = new TextEncoder().encode("0123456789");
  const opened = [];
  const closed = [];
  const source = {
    size: bytes.length,
    open(start, length) {
      opened.push([start, length]);
      let position = start;
      const end = start + length;
      let isClosed = false;
      return {
        async read(maximumBytes) {
          assert.equal(isClosed, false);
          if (position === end) return undefined;
          const count = Math.min(maximumBytes, 2, end - position);
          const chunk = bytes.slice(position, position + count);
          position += count;
          return chunk;
        },
        async close() {
          if (!isClosed) {
            isClosed = true;
            closed.push([start, length]);
          }
        },
      };
    },
  };

  const stored = _createBlobFromExternalSource(source, "TEXT/PLAIN");
  assert.equal(stored.size, 10);
  assert.equal(stored.type, "TEXT/PLAIN");
  assert.equal(opened.length, 0, "construction must not read provider storage");

  const composed = new Blob(["<", stored.slice(2, 8), ">"]);
  assert.equal(opened.length, 0, "composition and slicing must remain lazy");
  assert.equal(await composed.text(), "<234567>");
  assert.deepEqual(opened, [[2, 6]]);
  assert.deepEqual(closed, [[2, 6]]);
  assert.equal(await composed.text(), "<234567>");
  assert.deepEqual(opened, [
    [2, 6],
    [2, 6],
  ]);
  assert.deepEqual(closed, opened);

  const reader = composed.stream().getReader();
  const streamed = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    streamed.push(...result.value);
  }
  assert.equal(new TextDecoder().decode(Uint8Array.from(streamed)), "<234567>");
  assert.deepEqual(opened, [
    [2, 6],
    [2, 6],
    [2, 6],
  ]);
  assert.deepEqual(closed, opened);
});
test("Blob provider storage rejects short reads and always closes its reader", async () => {
  let closes = 0;
  const blob = _createBlobFromExternalSource({
    size: 4,
    open() {
      return {
        read() {
          return Promise.resolve(undefined);
        },
        close() {
          closes++;
          return Promise.resolve();
        },
      };
    },
  });

  await assert.rejects(blob.bytes(), (error) => {
    assert(error instanceof DOMException);
    assert.equal(error.name, "NotReadableError");
    return true;
  });
  assert.equal(closes, 1);

  const overRead = _createBlobFromExternalSource({
    size: 65_537,
    open() {
      return {
        read(maximumBytes) {
          return Promise.resolve(new Uint8Array(maximumBytes + 1));
        },
        close() {
          closes++;
          return Promise.resolve();
        },
      };
    },
  });
  await assert.rejects(overRead.stream().getReader().read(), (error) => {
    assert(error instanceof DOMException);
    assert.equal(error.name, "NotReadableError");
    return true;
  });
  assert.equal(closes, 2);
});
test("Blob memory streams bound chunks and never expose immutable storage", async () => {
  const source = new Uint8Array(65_536 * 2 + 3);
  source.fill(7);
  const blob = new Blob([source]);
  source.fill(9);
  const reader = blob.stream().getReader();
  const lengths = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    lengths.push(result.value.length);
    result.value.fill(1);
  }
  assert.deepEqual(lengths, [65_536, 65_536, 3]);
  assert.equal((await blob.bytes())[0], 7);
});
test("URLSearchParams differential and URL-encoded body consumption", async () => {
  for (const text of [
    "?a=1&a=2&x=a+b",
    "x=%FF%GG&=v",
    "a=~!*()&b=💙",
    "lone=\ud800",
    `long=${"a b+c/💙".repeat(1_025)}`,
  ]) {
    const a = new URLSearchParams(text),
      b = new globalThis.URLSearchParams(text);
    assert.deepEqual([...a], [...b]);
    assert.equal(a.toString(), b.toString());
  }

  function* generatedPair() {
    yield "generated";
    yield 42;
  }
  function* generatedSequence() {
    yield generatedPair();
    yield ["second", true];
  }
  function callablePair() {}
  callablePair[Symbol.iterator] = function* () {
    yield "callable";
    yield "pair";
  };
  for (const makeInit of [
    () => generatedSequence(),
    () => [callablePair],
    () => ({ b: 2, a: 1 }),
    () => ({ 2: "two", 1: "one", tail: "last" }),
    () => new globalThis.URLSearchParams("copy=1&copy=2"),
  ]) {
    assert.deepEqual(
      [...new URLSearchParams(makeInit())],
      [...new globalThis.URLSearchParams(makeInit())],
    );
  }
  for (const malformed of [[[]], [["only"]], [["a", "b", "extra"]], ["ab"]]) {
    assert.throws(() => new URLSearchParams(malformed), TypeError);
  }

  const coerced = new URLSearchParams();
  const nativeCoerced = new globalThis.URLSearchParams();
  for (const params of [coerced, nativeCoerced]) {
    params.append(1, true);
    params.set(false, 0);
  }
  assert.deepEqual([...coerced], [...nativeCoerced]);
  assert.equal(coerced.get(1), nativeCoerced.get(1));
  assert.equal(coerced.has(false, 0), nativeCoerced.has(false, 0));

  const r = makeResponse(new URLSearchParams("a=1&a=2"));
  assert.deepEqual(
    [...(await r.formData())],
    [
      ["a", "1"],
      ["a", "2"],
    ],
  );
});
test("RFC 6455 handshake test vector and random keys", () => {
  assert.equal(websocketAccept("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  for (let i = 0; i < 50; i++) {
    const key = Buffer.from("key" + i).toString("base64");
    assert.equal(
      websocketAccept(key),
      createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64"),
    );
  }
});
function readerFrom(bytes, split = 1) {
  let at = 0;
  return new BufferedReader({
    closed: false,
    async read(max) {
      if (at === bytes.length) return null;
      const end = Math.min(at + split, at + max, bytes.length);
      const part = bytes.slice(at, end);
      at = end;
      return part;
    },
    async write() {
      throw new Error("unused");
    },
    close() {},
  });
}
for (const length of [0, 1, 125, 126, 65535, 65536])
  test("Frame codec length " + length, async () => {
    const payload = new Uint8Array(length);
    for (let i = 0; i < length; i++) payload[i] = i & 255;
    const parts = encodeFrame(
      { fin: true, opcode: 2, payload },
      {
        fill(bytes) {
          bytes.set([1, 2, 3, 4]);
        },
      },
      true,
    );
    const wire = Buffer.concat(parts);
    const frame = await readFrame(readerFrom(wire, 113), true, 100000);
    assert.deepEqual(frame.payload, payload);
    assert.equal(frame.opcode, 2);
    assert.equal(frame.fin, true);
  });
test("Frame rejects nonminimal length, masking, reserved bits and bad controls", async () => {
  for (const wire of [
    [0x82, 126, 0, 1, 0],
    [0x82, 128, 0, 0, 0, 0],
    [0xc2, 0],
    [0x09, 0],
    [0x89, 126, 0, 126],
    [0x83, 0],
    [0x82, 127, 128, 0, 0, 0, 0, 0, 0, 0],
  ]) {
    await assert.rejects(readFrame(readerFrom(Uint8Array.from(wire)), false, 100000));
  }
  assert.deepEqual(parseClose(closePayload(1000, "Καλημέρα")), { code: 1000, reason: "Καλημέρα" });
  assert.throws(() => parseClose(Uint8Array.of(1)));
  assert.throws(() => closePayload(1006, ""));
});
test("WebSocket public and wire close-code domains remain distinct", () => {
  for (const code of [1000, 1001, 1002, 1003, 1007, 1011, 1012, 1013, 1014, 3000, 4999]) {
    assert.equal(isValidWireCloseCode(code), true, String(code));
  }
  for (const code of [999, 1004, 1005, 1006, 1015, 1016, 2999, 5000]) {
    assert.equal(isValidWireCloseCode(code), false, String(code));
  }

  assert.deepEqual(parseClose(closePayload(1002, "")), { code: 1002, reason: "" });
});
test("Web IDL conversions clamp with ties-to-even and replace lone surrogates", () => {
  for (const [input, expected] of [
    [NaN, 0],
    [-Infinity, 0],
    [-1, 0],
    [2998.5, 2998],
    [2999.5, 3000],
    [3000.5, 3000],
    [3001.5, 3002],
    [4999.5, 5000],
    [Infinity, 65535],
  ]) {
    assert.equal(toClampedUnsignedShort(input), expected);
  }
  assert.equal(toUSVString("a\ud800b\udc00c\ud83d\udc99"), "a\ufffdb\ufffdc\ud83d\udc99");
});
test("HTTP chunk extensions follow the RFC 9112 grammar", () => {
  for (const [line, expected] of [
    ["0", 0],
    ["00;done", 0],
    ["a;token=value", 10],
    ['A \t; \tquoted \t= \t"value\\\"part" ; flag', 10],
    ["ffffffff", 4_294_967_295],
    ["1fffffffffffff", Number.MAX_SAFE_INTEGER],
  ]) {
    assert.equal(parseChunkSize(line), expected);
  }
  for (const line of [
    "1 ",
    "1;",
    "1;=value",
    "1;name ",
    "1;name=",
    "1;name=()",
    '1;name="unterminated',
    '1;name="value"junk',
    "1 trailing",
    "20000000000000",
  ]) {
    assert.throws(() => parseChunkSize(line), undefined, line);
  }
});
test("HTTP response heads parse incrementally without relaxing wire grammar", async () => {
  const wire = Buffer.from(
    "HTTP/1.1 206 Partial Content\r\nX-A:  one\t\r\nSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n\r\n",
    "latin1",
  );
  for (let split = 1; split <= wire.length; split++) {
    assert.deepEqual(await readHead(readerFrom(wire, split)), {
      version: "1.1",
      status: 206,
      statusText: "Partial Content",
      headers: [
        ["x-a", "one"],
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
      ],
    });
  }

  for (const line of [
    "HTTP/1.1 200",
    "HTTP/1.2 200 OK",
    "HTTP/1.1 20x OK",
    "HTTP/1.1 099 Continue",
    "HTTP/1.1 600 Nope",
  ]) {
    await assert.rejects(readHead(readerFrom(Buffer.from(line + "\r\n\r\n", "latin1"), 1)));
  }
});
test("Content-Length and connection token parsing is strict and allocation-bounded", () => {
  assert.equal(contentLength(new Headers()), null);
  assert.equal(contentLength(new Headers([["content-length", "00042\t, 42"]])), 42);
  assert.equal(
    contentLength(new Headers([["content-length", String(Number.MAX_SAFE_INTEGER)]])),
    Number.MAX_SAFE_INTEGER,
  );
  for (const value of ["", "+1", "1.0", "1 2", "1,", "1, 2", "9007199254740992"]) {
    assert.throws(() => contentLength(new Headers([["content-length", value]])), undefined, value);
  }

  const connection = new Headers([["connection", "upgrade, Keep-Alive"]]);
  assert.equal(hasToken(connection, "connection", "keep-alive"), true);
  assert.equal(hasToken(connection, "connection", "close"), false);
});
test.after(() => api.close());
test("Header HTTP whitespace normalization, non-breaking space and embedded newline rejection", () => {
  for (const value of [
    "\r\n newLine",
    "newLine\r\n ",
    "\r\n\tnewLine",
    "\t\f\tnewLine\n",
    "newLine\xa0",
  ]) {
    assert.equal(new Headers([["x", value]]).get("x"), new NativeHeaders([["x", value]]).get("x"));
  }
  assert.throws(() => new Headers([["x", "a\r\nb"]]));
});
test("TextDecoder labels trim ASCII whitespace but not other Unicode whitespace", () => {
  for (const label of ["\tutf-8\r", "\futf8\n", " unicode-1-1-utf-8 "]) {
    assert.equal(new TextDecoder(label).encoding, new NativeDecoder(label).encoding);
  }
  for (const label of ["\u00a0utf-8", "utf-8\u00a0", "\u2003utf-8"]) {
    assert.throws(() => new TextDecoder(label));
    assert.throws(() => new NativeDecoder(label));
  }
});
test("Multipart roundtrip preserves duplicate text entries, binary files and UTF-8 names", async () => {
  const form = new FormData();
  form.append("name", "first");
  form.append("name", "second");
  form.append(
    "φάκελος",
    new File([Uint8Array.of(0, 255, 13, 10)], "δοκιμή.bin", { type: "application/octet-stream" }),
  );
  const parsed = await makeResponse(form).formData();
  assert.deepEqual(parsed.getAll("name"), ["first", "second"]);
  const file = parsed.get("φάκελος");
  assert.equal(file.name, "δοκιμή.bin");
  assert.deepEqual(await file.bytes(), Uint8Array.of(0, 255, 13, 10));
});
test("Multipart serialization matches Node wire escaping and newline normalization", async () => {
  const actualForm = new FormData();
  actualForm.append('a\r\nb"', "x\ry\nz\r\nw");
  actualForm.append("f", new File(["ok"], 'n\r\n".txt', { type: "text/plain" }));
  const actual = encodeMultipart(actualForm, {
    fill(bytes) {
      bytes.fill(0);
    },
  });
  const actualBoundary = actual.contentType.slice("multipart/form-data; boundary=".length);

  const expectedForm = new NativeFormData();
  expectedForm.append('a\r\nb"', "x\ry\nz\r\nw");
  expectedForm.append("f", new NativeFile(["ok"], 'n\r\n".txt', { type: "text/plain" }));
  const expectedRequest = new NativeRequest("http://example.test", {
    method: "POST",
    body: expectedForm,
  });
  const expectedType = expectedRequest.headers.get("content-type");
  assert.ok(expectedType);
  const expectedBoundary = expectedType.slice("multipart/form-data; boundary=".length);
  const expected = (await expectedRequest.text()).split(expectedBoundary).join(actualBoundary);

  assert.equal(await actual.blob.text(), expected);
});
test("Multipart quoted boundary, preamble/epilogue and boundary-like payload", async () => {
  const text =
    'preamble\r\n--b\r\nContent-Disposition: form-data; name="x"\r\n\r\na\r\n--bNO\r\nb\r\n--b--\r\nepilogue';
  const parsed = await makeResponse(text, {
    headers: [["content-type", 'multipart/form-data; boundary="b"']],
  }).formData();
  assert.equal(parsed.get("x"), "a\r\n--bNO\r\nb");
});
test("Malformed multipart never returns a partial form", async () => {
  for (const text of [
    '--b\r\nContent-Disposition: form-data; name="x"\r\n\r\nno-end',
    "--b\r\nContent-Disposition: form-data\r\n\r\nx\r\n--b--",
    '--b\r\nContent-Disposition: form-data; name="unterminated\r\n\r\nx\r\n--b--',
  ]) {
    await assert.rejects(
      makeResponse(text, {
        headers: [["content-type", "multipart/form-data; boundary=b"]],
      }).formData(),
    );
  }
});
test("Body.formData uses MIME parsing, consumes failures, and gives files the specified type", async () => {
  const multipart =
    '--b\r\nContent-Disposition: form-data; name="x"; filename="a.txt"\r\n\r\ny\r\n--b--';

  for (const contentType of [
    "multipart/form-data; broken; boundary=b",
    'multipart/form-data; boundary="b"junk',
  ]) {
    const actual = await makeResponse(multipart, {
      headers: [["content-type", contentType]],
    }).formData();
    const expected = await new NativeResponse(multipart, {
      headers: [["content-type", contentType]],
    }).formData();
    const actualFile = actual.get("x");
    const expectedFile = expected.get("x");

    assert.equal(actualFile.name, expectedFile.name);
    assert.equal(actualFile.type, expectedFile.type);
    assert.equal(await actualFile.text(), await expectedFile.text());
  }

  for (const contentType of [
    "multipart/form-data; boundary= b",
    "\fapplication/x-www-form-urlencoded",
    "\u00a0application/x-www-form-urlencoded",
  ]) {
    const payload = contentType.startsWith("multipart") ? multipart : "x=y";
    const response = makeResponse(payload, {
      headers: [["content-type", contentType]],
    });
    const expected = new NativeResponse(payload, {
      headers: [["content-type", contentType]],
    });

    await assert.rejects(response.formData());
    await assert.rejects(expected.formData());
    assert.equal(response.bodyUsed, expected.bodyUsed);
  }
});
test("Abort event-handler insertion order, replacement, receiver and dispatch phase", () => {
  const c = new AbortController();
  const order = [];
  c.signal.addEventListener("abort", () => order.push(1));
  c.signal.onabort = () => order.push("replaced");
  c.signal.addEventListener("abort", () => order.push(3));
  c.signal.onabort = function (event) {
    assert.equal(this, c.signal);
    assert.equal(event.currentTarget, c.signal);
    assert.equal(event.eventPhase, 2);
    order.push(2);
  };
  c.abort();
  assert.deepEqual(order, [1, 2, 3]);
});
test("onabort can be stopped by an earlier listener without stopping internal abort algorithms", () => {
  const c = new AbortController();
  let property = false,
    internal = false;
  c.signal.addEventListener("abort", (e) => e.stopImmediatePropagation());
  c.signal.onabort = () => (property = true);
  c.signal.subscribe(() => (internal = true));
  c.abort();
  assert.equal(property, false);
  assert.equal(internal, true);
});
test("Released reader.closed rejects even if the previous closed promise was fulfilled", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.close();
    },
  });
  const reader = stream.getReader();
  const prior = reader.closed;
  await prior;
  reader.releaseLock();
  await assert.rejects(reader.closed);
  await prior;
});
test("Readable stream internals cannot be shadowed by public expandos", async () => {
  const source = {
    pull(controller) {
      assert.equal(this, source);
      controller.enqueue("kept");
      controller.close();
    },
  };
  const stream = new ReadableStream(source, { highWaterMark: 0 });
  stream.source = null;
  stream.state = "errored";
  stream.queue = [];
  stream.controller = null;

  const reader = stream.getReader();
  reader.stream = null;
  reader.closedCapability = { promise: Promise.reject(new Error("shadow")) };
  reader.closedCapability.promise.catch(() => {});

  assert.deepEqual(await reader.read(), { done: false, value: "kept" });
  assert.deepEqual(await reader.read(), { done: true, value: undefined });
  await reader.closed;
});
test("Iterator always releases its lock when underlying cancellation rejects", async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(1);
    },
    cancel() {
      throw new Error("cancel failed");
    },
  });
  const iterator = stream.values();
  await iterator.next();
  await assert.rejects(iterator.return(), /cancel failed/);
  assert.equal(stream.locked, false);
});
test("Readable stream iteration serializes requests and releases its lock synchronously", async () => {
  const releases = [];
  let next = 0;
  const stream = new ReadableStream(
    {
      async pull(controller) {
        const release = Promise.withResolvers();
        releases.push(release);
        await release.promise;
        controller.enqueue(next++);
      },
    },
    { highWaterMark: 0 },
  );
  const iterator = stream.values();
  const first = iterator.next();
  const second = iterator.next();
  await tick();
  assert.equal(releases.length, 1);

  releases[0].resolve();
  assert.deepEqual(await first, { done: false, value: 0 });
  await tick();
  assert.equal(releases.length, 2);
  releases[1].resolve();
  assert.deepEqual(await second, { done: false, value: 1 });
  await tick();

  const returned = iterator.return("finished");
  assert.equal(stream.locked, false);
  assert.deepEqual(await returned, { done: true, value: "finished" });
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
});
test("ReadableStream.from is demand-driven and closes its iterator with the cancel reason", async () => {
  const returnGate = Promise.withResolvers();
  const cancelReason = new Error("cancelled");
  const events = [];
  const iterator = {
    next() {
      assert.equal(this, iterator);
      events.push("next");
      return Promise.resolve({ done: false, value: events.length });
    },
    async return(reason) {
      assert.equal(this, iterator);
      events.push(["return", reason]);
      await returnGate.promise;
      return { done: true };
    },
  };
  const iterable = {
    [Symbol.asyncIterator]() {
      assert.equal(this, iterable);
      events.push("open");
      return iterator;
    },
  };

  const stream = ReadableStream.from(iterable);
  assert.deepEqual(events, ["open"]);
  await tick();
  assert.deepEqual(events, ["open"]);
  const reader = stream.getReader();
  assert.deepEqual(await reader.read(), { done: false, value: 2 });

  let canceled = false;
  const cancellation = reader.cancel(cancelReason).then(() => {
    canceled = true;
  });
  await tick();
  assert.equal(canceled, false);
  assert.deepEqual(events, ["open", "next", ["return", cancelReason]]);
  returnGate.resolve();
  await cancellation;
  assert.equal(canceled, true);

  const promisedValues = ReadableStream.from([Promise.resolve("a"), Promise.resolve("b")]);
  const values = [];
  for await (const value of promisedValues) values.push(value);
  assert.deepEqual(values, ["a", "b"]);
});
test("Response.clone retains an immutable redirect header guard", () => {
  const clone = makeRedirectResponse("https://example.test/").clone();
  assert.throws(() => clone.headers.set("x", "y"));
  assert.equal(clone.headers.get("location"), "https://example.test/");
});
