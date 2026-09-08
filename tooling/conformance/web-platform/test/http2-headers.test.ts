import test from "node:test";
import assert from "node:assert/strict";
import {
  http2HeaderListSize,
  parseHttp2ResponseHeaders,
  parseHttp2Trailers,
  validateHttp2RequestHeaders,
} from "../../../../runtime/web-platform/src/http2/headers.ts";

function encoded(...pairs: readonly [string, string][]) {
  return pairs.map(([name, value]) => ({ name, value }));
}

function decoded(...pairs: readonly [string, string][]) {
  return pairs.map(([name, value]) => ({ name, value, neverIndexed: false }));
}

test("ordinary, CONNECT, and extended CONNECT request pseudo-headers are distinct", () => {
  assert.doesNotThrow(() =>
    validateHttp2RequestHeaders(
      encoded(
        [":method", "GET"],
        [":scheme", "https"],
        [":authority", "example.test"],
        [":path", "/resource"],
        ["accept", "*/*"],
      ),
      1,
      false,
    ),
  );
  assert.doesNotThrow(() =>
    validateHttp2RequestHeaders(
      encoded(
        [":method", "GET"],
        [":scheme", "https"],
        [":authority", "example.test"],
        [":path", "/resource"],
        ["te", "trailers, Trailers"],
      ),
      1,
      false,
    ),
  );
  assert.doesNotThrow(() =>
    validateHttp2RequestHeaders(
      encoded(
        [":method", "GET"],
        [":scheme", "https"],
        [":authority", "example.test"],
        [":path", "/resource"],
        ["te", "Trailers"],
      ),
      1,
      false,
    ),
  );
  assert.doesNotThrow(() =>
    validateHttp2RequestHeaders(
      encoded([":method", "CONNECT"], [":authority", "example.test:443"]),
      3,
      false,
    ),
  );
  const extended = encoded(
    [":method", "CONNECT"],
    [":protocol", "websocket"],
    [":scheme", "https"],
    [":authority", "example.test"],
    [":path", "/chat"],
  );
  assert.doesNotThrow(() => validateHttp2RequestHeaders(extended, 5, true));
  assert.throws(() => validateHttp2RequestHeaders(extended, 5, false), /not enabled/);
});

test("request pseudo-header ordering, presence, and duplication are enforced", () => {
  for (const fields of [
    encoded([":scheme", "https"], [":authority", "example.test"], [":path", "/"]),
    encoded([":method", "GET"], [":authority", "example.test"], [":path", "/"]),
    encoded([":method", "GET"], [":scheme", "https"], [":authority", "example.test"]),
    encoded(
      [":method", "GET"],
      [":method", "POST"],
      [":scheme", "https"],
      [":authority", "x"],
      [":path", "/"],
    ),
    encoded(
      [":method", "GET"],
      [":scheme", "https"],
      [":authority", "x"],
      ["accept", "*/*"],
      [":path", "/"],
    ),
    encoded(
      [":method", "GET"],
      [":scheme", "https"],
      [":authority", "x"],
      [":unknown", "x"],
      [":path", "/"],
    ),
  ]) {
    assert.throws(() => validateHttp2RequestHeaders(fields, 1, false));
  }
});

test("response pseudo-headers produce a status and never leak into regular fields", () => {
  assert.deepEqual(
    parseHttp2ResponseHeaders(
      decoded(
        [":status", "200"],
        ["content-type", "text/plain"],
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
        ["content-length", "12"],
      ),
      1,
    ),
    {
      status: 200,
      headers: decoded(
        ["content-type", "text/plain"],
        ["set-cookie", "a=1"],
        ["set-cookie", "b=2"],
        ["content-length", "12"],
      ),
      contentLength: 12,
    },
  );

  for (const fields of [
    decoded(["content-type", "text/plain"]),
    decoded([":status", "101"]),
    decoded([":status", "600"]),
    decoded([":status", "200"], [":status", "204"]),
    decoded([":status", "200"], ["x", "y"], [":path", "/"]),
  ]) {
    assert.throws(() => parseHttp2ResponseHeaders(fields, 1));
  }
});

test("connection-specific fields, invalid TE, uppercase names, and wire controls are malformed", () => {
  // Annotated rather than inferred: an array of two-element arrays widens to `string[][]`,
  // and `encoded` takes pairs.
  const malformed: readonly [string, string][] = [
    ["connection", "close"],
    ["keep-alive", "timeout=5"],
    ["proxy-connection", "close"],
    ["transfer-encoding", "chunked"],
    ["upgrade", "websocket"],
    ["te", "gzip"],
    ["X-Upper", "value"],
    ["x-control", "a\u0000b"],
    ["x-control", "a\u0001b"],
    ["x-control", "a\u007fb"],
    ["x-newline", "a\nb"],
    ["x-space", " value"],
    ["x-tab", "value\t"],
  ];
  for (const field of malformed) {
    assert.throws(() =>
      validateHttp2RequestHeaders(
        encoded(
          [":method", "GET"],
          [":scheme", "https"],
          [":authority", "example.test"],
          [":path", "/"],
          field,
        ),
        1,
        false,
      ),
    );
  }
});

test("Content-Length list members must be valid, exact, and identical", () => {
  assert.equal(
    parseHttp2ResponseHeaders(decoded([":status", "200"], ["content-length", "12,12"]), 1)
      .contentLength,
    12,
  );
  for (const value of ["", "+1", "1,2", "9007199254740992", " 1", "1 "]) {
    assert.throws(() =>
      parseHttp2ResponseHeaders(decoded([":status", "200"], ["content-length", value]), 1),
    );
  }
  assert.throws(() =>
    validateHttp2RequestHeaders(
      encoded(
        [":method", "POST"],
        [":scheme", "https"],
        [":authority", "example.test"],
        [":path", "/"],
        ["content-length", "1"],
        ["content-length", "2"],
      ),
      1,
      false,
    ),
  );
});

test("trailers forbid pseudo-headers and preserve duplicate regular fields", () => {
  const fields = decoded(["checksum", "one"], ["checksum", "two"]);
  assert.equal(parseHttp2Trailers(fields, 1), fields);
  assert.throws(() => parseHttp2Trailers(decoded([":status", "200"]), 1), /pseudo-header/);
  assert.throws(
    () => parseHttp2Trailers(decoded(["content-length", "1"]), 1),
    /framing or routing/,
  );
});

test("header-list accounting includes RFC 7541's per-field overhead", () => {
  assert.equal(http2HeaderListSize(encoded(["a", "b"], ["name", "value"])), 75);
});
