import test from "node:test";
import assert from "node:assert/strict";
import {
  HpackDecoder,
  HpackEncoder,
  decodeHpackInteger,
} from "../../../../runtime/web-platform/src/http2/hpack.ts";
import {
  decodeHpackHuffman,
  encodeHpackHuffman,
} from "../../../../runtime/web-platform/src/http2/hpack-huffman.ts";

function bytes(hex) {
  return Uint8Array.from(Buffer.from(hex.replaceAll(" ", ""), "hex"));
}

function hex(value) {
  return Buffer.from(value).toString("hex");
}

function fields(...pairs) {
  return pairs.map(([name, value]) => ({ name, value, neverIndexed: false }));
}

const firstRequest = [
  [":method", "GET"],
  [":scheme", "http"],
  [":path", "/"],
  [":authority", "www.example.com"],
];
const secondRequest = [...firstRequest, ["cache-control", "no-cache"]];
const thirdRequest = [
  [":method", "GET"],
  [":scheme", "https"],
  [":path", "/index.html"],
  [":authority", "www.example.com"],
  ["custom-key", "custom-value"],
];

test("RFC 7541 integer examples and malformed integer bounds", () => {
  for (const [encoded, prefix, expected] of [
    ["0a", 5, 10],
    ["1f9a0a", 5, 1337],
    ["2a", 8, 42],
  ]) {
    const cursor = { bytes: bytes(encoded), offset: 0 };
    assert.equal(decodeHpackInteger(cursor, prefix), expected);
    assert.equal(cursor.offset, cursor.bytes.length);
  }

  assert.throws(
    () => decodeHpackInteger({ bytes: bytes("1f"), offset: 0 }, 5),
    /Truncated HPACK block/,
  );
  assert.throws(
    () => decodeHpackInteger({ bytes: bytes("1fffffffff7f"), offset: 0 }, 5),
    /exceeds|too long/,
  );
});

test("RFC 7541 literal and indexed field examples", () => {
  const incremental = new HpackDecoder();
  assert.deepEqual(
    incremental.decode(bytes("400a637573746f6d2d6b65790d637573746f6d2d686561646572")),
    fields(["custom-key", "custom-header"]),
  );
  assert.equal(incremental.dynamicTableLength, 1);
  assert.equal(incremental.dynamicTableSize, 55);

  assert.deepEqual(
    new HpackDecoder().decode(bytes("040c2f73616d706c652f70617468")),
    fields([":path", "/sample/path"]),
  );
  assert.deepEqual(new HpackDecoder().decode(bytes("100870617373776f726406736563726574")), [
    { name: "password", value: "secret", neverIndexed: true },
  ]);
  assert.deepEqual(new HpackDecoder().decode(bytes("82")), fields([":method", "GET"]));
});

test("RFC 7541 request sequence without Huffman coding", () => {
  const decoder = new HpackDecoder();
  const encoder = new HpackEncoder(4096, false);
  const vectors = [
    ["828684410f7777772e6578616d706c652e636f6d", firstRequest],
    ["828684be58086e6f2d6361636865", secondRequest],
    ["828785bf400a637573746f6d2d6b65790c637573746f6d2d76616c7565", thirdRequest],
  ];

  for (const [encoded, expected] of vectors) {
    assert.deepEqual(decoder.decode(bytes(encoded)), fields(...expected));
    assert.equal(hex(encoder.encode(expected.map(([name, value]) => ({ name, value })))), encoded);
  }
  assert.equal(decoder.dynamicTableLength, 3);
  assert.equal(decoder.dynamicTableSize, 164);
});

test("RFC 7541 request sequence with Huffman coding", () => {
  const decoder = new HpackDecoder();
  const encoder = new HpackEncoder();
  const vectors = [
    ["828684418cf1e3c2e5f23a6ba0ab90f4ff", firstRequest],
    ["828684be5886a8eb10649cbf", secondRequest],
    ["828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf", thirdRequest],
  ];

  for (const [encoded, expected] of vectors) {
    assert.deepEqual(decoder.decode(bytes(encoded)), fields(...expected));
    assert.equal(hex(encoder.encode(expected.map(([name, value]) => ({ name, value })))), encoded);
  }
  assert.equal(decoder.dynamicTableLength, 3);
  assert.equal(decoder.dynamicTableSize, 164);
});

const firstResponse = [
  [":status", "302"],
  ["cache-control", "private"],
  ["date", "Mon, 21 Oct 2013 20:13:21 GMT"],
  ["location", "https://www.example.com"],
];
const secondResponse = [
  [":status", "307"],
  ["cache-control", "private"],
  ["date", "Mon, 21 Oct 2013 20:13:21 GMT"],
  ["location", "https://www.example.com"],
];
const thirdResponse = [
  [":status", "200"],
  ["cache-control", "private"],
  ["date", "Mon, 21 Oct 2013 20:13:22 GMT"],
  ["location", "https://www.example.com"],
  ["content-encoding", "gzip"],
  ["set-cookie", "foo=ASDJKHQKBZXOQWEOPIUAXQWEOIU; max-age=3600; version=1"],
];

test("RFC 7541 response sequences exercise the 256-byte eviction context", () => {
  const plain = [
    "4803333032580770726976617465611d4d6f6e2c203231204f637420323031332032303a31333a323120474d546e1768747470733a2f2f7777772e6578616d706c652e636f6d",
    "4803333037c1c0bf",
    "88c1611d4d6f6e2c203231204f637420323031332032303a31333a323220474d54c05a04677a69707738666f6f3d4153444a4b48514b425a584f5157454f50495541585157454f49553b206d61782d6167653d333630303b2076657273696f6e3d31",
  ];
  const compressed = [
    "488264025885aec3771a4b6196d07abe941054d444a8200595040b8166e082a62d1bff6e919d29ad171863c78f0b97c8e9ae82ae43d3",
    "4883640effc1c0bf",
    "88c16196d07abe941054d444a8200595040b8166e084a62d1bffc05a839bd9ab77ad94e7821dd7f2e6c7b335dfdfcd5b3960d5af27087f3672c1ab270fb5291f9587316065c003ed4ee5b1063d5007",
  ];
  const expected = [firstResponse, secondResponse, thirdResponse];

  for (const vectors of [plain, compressed]) {
    const decoder = new HpackDecoder(256);
    for (let i = 0; i < vectors.length; i++) {
      assert.deepEqual(decoder.decode(bytes(vectors[i])), fields(...expected[i]));
    }
    assert.equal(decoder.dynamicTableLength, 3);
    assert.equal(decoder.dynamicTableSize, 215);
  }

  const encoder = new HpackEncoder(256, false);
  for (let i = 0; i < plain.length; i++) {
    const source = expected[i].map(([name, value]) => ({
      name,
      value,
      indexing: "incremental",
    }));
    assert.equal(hex(encoder.encode(source)), plain[i]);
  }
});

test("HPACK Huffman codec covers every octet and validates EOS padding", () => {
  const all = Uint8Array.from({ length: 256 }, (_, index) => index);
  const compressed = encodeHpackHuffman(all);
  assert.deepEqual(decodeHpackHuffman(compressed, all.length), all);
  assert.equal(
    hex(encodeHpackHuffman(bytes("7777772e6578616d706c652e636f6d"))),
    "f1e3c2e5f23a6ba0ab90f4ff",
  );

  assert.throws(() => decodeHpackHuffman(bytes("fffffffc"), 1024), /EOS/);
  assert.throws(() => decodeHpackHuffman(bytes("1e"), 1024), /padding/);
  assert.throws(() => decodeHpackHuffman(bytes("ff"), 1024), /padding/);
  assert.throws(() => decodeHpackHuffman(compressed, 255), /configured limit/);
});

test("dynamic table indexing, eviction, and oversized-entry clearing", () => {
  const encoder = new HpackEncoder(80, false);
  const decoder = new HpackDecoder(80);
  const custom = [{ name: "custom-key", value: "custom-value" }];

  const first = encoder.encode(custom);
  assert.deepEqual(decoder.decode(first), fields(["custom-key", "custom-value"]));
  assert.equal(decoder.dynamicTableLength, 1);
  const second = encoder.encode(custom);
  assert.deepEqual(decoder.decode(second), fields(["custom-key", "custom-value"]));
  assert.equal(hex(second), "be");

  const tooLarge = [{ name: "large", value: "x".repeat(80) }];
  assert.deepEqual(decoder.decode(encoder.encode(tooLarge)), fields(["large", "x".repeat(80)]));
  assert.equal(encoder.dynamicTableLength, 0);
  assert.equal(decoder.dynamicTableLength, 0);
});

test("never-indexed and without-indexing policy cannot collapse to indexed fields", () => {
  const encoder = new HpackEncoder(4096, false);
  const decoder = new HpackDecoder();
  const never = encoder.encode([{ name: "authorization", value: "secret", indexing: "never" }]);
  const without = encoder.encode([{ name: ":method", value: "GET", indexing: "without" }]);

  assert.equal(hex(never), "1f0806736563726574");
  assert.equal(hex(without), "0203474554");
  assert.deepEqual(decoder.decode(never), [
    { name: "authorization", value: "secret", neverIndexed: true },
  ]);
  assert.deepEqual(decoder.decode(without), fields([":method", "GET"]));
  assert.equal(encoder.dynamicTableLength, 0);
  assert.equal(decoder.dynamicTableLength, 0);
});

test("credential-bearing fields default to never-indexed literals", () => {
  for (const name of ["authorization", "proxy-authorization", "cookie", "set-cookie"]) {
    const encoded = new HpackEncoder(4096, false).encode([{ name, value: "secret" }]);
    const decoded = new HpackDecoder().decode(encoded);
    assert.deepEqual(decoded, [{ name, value: "secret", neverIndexed: true }]);
  }
});

test("table-size updates carry the smallest and final values before fields", () => {
  const encoder = new HpackEncoder();
  encoder.setMaximumTableSize(0);
  encoder.setMaximumTableSize(100);
  const block = encoder.encode([{ name: ":method", value: "GET" }]);
  assert.equal(hex(block), "203f4582");

  const decoder = new HpackDecoder();
  decoder.setMaximumTableSize(0);
  decoder.setMaximumTableSize(100);
  assert.deepEqual(decoder.decode(block), fields([":method", "GET"]));
  assert.equal(decoder.dynamicTableCapacity, 100);

  const missingMinimum = new HpackDecoder();
  missingMinimum.setMaximumTableSize(0);
  missingMinimum.setMaximumTableSize(100);
  assert.throws(() => missingMinimum.decode(bytes("3f4582")), /required minimum/);
});

test("decoder rejects invalid indexes, update placement, excess updates, and table overflow", () => {
  assert.throws(() => new HpackDecoder().decode(bytes("80")), /index zero/);
  assert.throws(() => new HpackDecoder().decode(bytes("ff00")), /outside the table/);
  assert.throws(() => new HpackDecoder().decode(bytes("8220")), /followed a header/);
  assert.throws(() => new HpackDecoder().decode(bytes("202020")), /Too many/);
  assert.throws(() => new HpackDecoder(128).decode(bytes("3f62")), /advertised maximum/);

  const decoder = new HpackDecoder();
  decoder.setMaximumTableSize(128);
  assert.throws(() => decoder.decode(bytes("82")), /omitted a required/);
});

test("encoded string and decoded header-list limits are independently enforced", () => {
  const encoded = new HpackEncoder(4096, false).encode([
    { name: "custom", value: "12345678", indexing: "without" },
  ]);
  assert.throws(
    () => new HpackDecoder(4096, { maxStringBytes: 7, maxHeaderListBytes: 1024 }).decode(encoded),
    /Encoded HPACK string/,
  );
  assert.throws(
    () => new HpackDecoder(4096, { maxStringBytes: 1024, maxHeaderListBytes: 40 }).decode(encoded),
    /header list/,
  );
});

test("HPACK preserves opaque ByteString octets and duplicate ordering", () => {
  const input = [
    { name: "x-byte", value: "\u0000\u0080\u00ff" },
    { name: "x-byte", value: "second", indexing: "without" },
  ];
  const decoder = new HpackDecoder();
  const decoded = decoder.decode(new HpackEncoder().encode(input));
  assert.deepEqual(decoded, fields(["x-byte", "\u0000\u0080\u00ff"], ["x-byte", "second"]));
  assert.throws(() => new HpackEncoder().encode([{ name: "x", value: "\u0100" }]), /ByteString/);
});
