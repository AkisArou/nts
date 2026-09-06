// Adapted from the verified external delivery after removing its synthetic realm API.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Headers,
  Request,
  Response,
  ReadableStream,
  AbortController,
  AbortSignal,
  CloseEvent,
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
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { encodeMultipart } from "../node_modules/.tsbuild/host/runtime/web-platform/src/forms/multipart.js";
import {
  bytesStream,
  tee,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/streams/readable.js";
import { BufferedReader } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/io.js";
import { parseChunkSize } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/parser.js";
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
const NativeResponse = globalThis.Response;
const NativeFormData = globalThis.FormData;
const NativeURLSearchParams = globalThis.URLSearchParams;
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
test("AbortSignal.any selects the first reason and detaches", () => {
  const a = new AbortController(),
    b = new AbortController();
  const combined = AbortSignal.any([a.signal, b.signal]);
  b.abort("b");
  a.abort("a");
  assert.equal(combined.reason, "b");
  assert.equal(AbortSignal.any([a.signal, b.signal]).reason, "a");
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
test("URLSearchParams differential and URL-encoded body consumption", async () => {
  for (const text of ["?a=1&a=2&x=a+b", "x=%FF%GG&=v", "a=~!*()&b=💙"]) {
    const a = new URLSearchParams(text),
      b = new globalThis.URLSearchParams(text);
    assert.deepEqual([...a], [...b]);
    assert.equal(a.toString(), b.toString());
  }
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
  ]) {
    assert.throws(() => parseChunkSize(line), undefined, line);
  }
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
test("Response.clone retains an immutable redirect header guard", () => {
  const clone = makeRedirectResponse("https://example.test/").clone();
  assert.throws(() => clone.headers.set("x", "y"));
  assert.equal(clone.headers.get("location"), "https://example.test/");
});
