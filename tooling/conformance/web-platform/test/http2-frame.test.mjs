import test from "node:test";
import assert from "node:assert/strict";
import { BufferedReader } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/io.js";
import {
  HTTP2_DEFAULT_FRAME_SIZE,
  HTTP2_FLAG_ACK,
  HTTP2_FLAG_END_HEADERS,
  HTTP2_FLAG_END_STREAM,
  HTTP2_FLAG_PADDED,
  HTTP2_FLAG_PRIORITY,
  HTTP2_FRAME_CONTINUATION,
  HTTP2_FRAME_DATA,
  HTTP2_FRAME_SIZE_ERROR,
  HTTP2_FRAME_GOAWAY,
  HTTP2_FRAME_HEADERS,
  HTTP2_FRAME_PING,
  HTTP2_FRAME_PRIORITY,
  HTTP2_FRAME_PUSH_PROMISE,
  HTTP2_FRAME_RST_STREAM,
  HTTP2_FRAME_SETTINGS,
  HTTP2_FRAME_WINDOW_UPDATE,
  HTTP2_PROTOCOL_ERROR,
  HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL,
  HTTP2_SETTING_ENABLE_PUSH,
  HTTP2_SETTING_HEADER_TABLE_SIZE,
  HTTP2_SETTING_INITIAL_WINDOW_SIZE,
  HTTP2_SETTING_MAX_FRAME_SIZE,
  Http2HeaderBlockAssembler,
  decodeHttp2Frame,
  encodeHttp2ErrorCode,
  encodeHttp2Frame,
  encodeHttp2GoAway,
  encodeHttp2Settings,
  encodeHttp2WindowUpdate,
  parseHttp2Data,
  parseHttp2GoAway,
  parseHttp2Headers,
  parseHttp2Priority,
  parseHttp2PushPromise,
  parseHttp2RstStream,
  parseHttp2Settings,
  parseHttp2WindowUpdate,
  readHttp2Frame,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/http2/frame.js";

function bytes(...values) {
  return Uint8Array.from(values);
}

function frame(type, flags, streamId, payload = new Uint8Array(0)) {
  return { type, flags, streamId, payload };
}

function chunkedConnection(source, splits) {
  let offset = 0;
  let split = 0;
  return {
    closed: false,
    async read(maxBytes) {
      if (offset === source.length) return null;
      const wanted = splits[split++] ?? source.length - offset;
      const end = Math.min(source.length, offset + wanted, offset + maxBytes);
      const result = source.slice(offset, end);
      offset = end;
      return result;
    },
    async write(data) {
      return data.length;
    },
    close() {
      this.closed = true;
    },
  };
}

test("HTTP/2 frame envelope round-trips every field and ignores the reserved stream bit", () => {
  const source = frame(0xf0, 0xa5, 0x1234567, bytes(0, 1, 254, 255));
  const encoded = encodeHttp2Frame(source);
  assert.deepEqual(decodeHttp2Frame(encoded), source);

  encoded[5] |= 0x80;
  assert.equal(decodeHttp2Frame(encoded).streamId, source.streamId);
  assert.throws(
    () => decodeHttp2Frame(encoded.subarray(0, encoded.length - 1)),
    (error) => {
      assert.equal(error.errorCode, HTTP2_FRAME_SIZE_ERROR);
      return true;
    },
  );
});

test("incremental reader handles every split across frame headers and payloads", async () => {
  const expected = frame(0xee, 0x41, 17, bytes(1, 2, 3, 4, 5, 6, 7));
  const wire = encodeHttp2Frame(expected);
  for (let split = 1; split < wire.length; split++) {
    const connection = chunkedConnection(wire, [split]);
    assert.deepEqual(await readHttp2Frame(new BufferedReader(connection)), expected);
  }
});

test("SETTINGS pairs preserve order and enforce all defined value domains", () => {
  const expected = [
    { identifier: HTTP2_SETTING_HEADER_TABLE_SIZE, value: 1234 },
    { identifier: HTTP2_SETTING_ENABLE_PUSH, value: 0 },
    { identifier: HTTP2_SETTING_INITIAL_WINDOW_SIZE, value: 0x7fffffff },
    { identifier: HTTP2_SETTING_MAX_FRAME_SIZE, value: 0xffffff },
    { identifier: HTTP2_SETTING_ENABLE_CONNECT_PROTOCOL, value: 1 },
    { identifier: 0xbeef, value: 0xffffffff },
  ];
  const settings = frame(HTTP2_FRAME_SETTINGS, 0, 0, encodeHttp2Settings(expected));
  assert.deepEqual(parseHttp2Settings(settings), expected);

  assert.throws(() => parseHttp2Settings(frame(HTTP2_FRAME_SETTINGS, 0, 1)), /stream identifier/);
  assert.throws(
    () => parseHttp2Settings(frame(HTTP2_FRAME_SETTINGS, HTTP2_FLAG_ACK, 0, bytes(0))),
    /payload/,
  );
  assert.throws(
    () => parseHttp2Settings(frame(HTTP2_FRAME_SETTINGS, 0, 0, bytes(0, 1, 0))),
    /sequence/,
  );
  assert.throws(
    () =>
      encodeHttp2Settings([{ identifier: HTTP2_SETTING_INITIAL_WINDOW_SIZE, value: 0x80000000 }]),
    (error) => error.errorCode === 3,
  );
  assert.throws(
    () => encodeHttp2Settings([{ identifier: HTTP2_SETTING_MAX_FRAME_SIZE, value: 16383 }]),
    (error) => error.errorCode === HTTP2_PROTOCOL_ERROR,
  );
  assert.throws(
    () => encodeHttp2Settings([{ identifier: HTTP2_SETTING_ENABLE_PUSH, value: 2 }]),
    /neither zero nor one/,
  );
});

test("DATA, HEADERS, PRIORITY, and PUSH_PROMISE expose exact unpadded ranges", () => {
  const data = frame(HTTP2_FRAME_DATA, HTTP2_FLAG_PADDED, 1, bytes(2, 10, 11, 0, 0));
  assert.deepEqual(parseHttp2Data(data), { data: bytes(10, 11), paddingBytes: 2 });

  const headers = frame(
    HTTP2_FRAME_HEADERS,
    HTTP2_FLAG_PADDED | HTTP2_FLAG_PRIORITY,
    3,
    bytes(1, 0x80, 0, 0, 1, 15, 20, 21, 0),
  );
  assert.deepEqual(parseHttp2Headers(headers), {
    fragment: bytes(20, 21),
    paddingBytes: 1,
    priority: { exclusive: true, streamDependency: 1, weight: 16 },
  });

  const priority = frame(HTTP2_FRAME_PRIORITY, 0, 7, bytes(0, 0, 0, 3, 255));
  assert.deepEqual(parseHttp2Priority(priority), {
    exclusive: false,
    streamDependency: 3,
    weight: 256,
  });

  const push = frame(HTTP2_FRAME_PUSH_PROMISE, HTTP2_FLAG_PADDED, 9, bytes(1, 0, 0, 0, 2, 30, 0));
  assert.deepEqual(parseHttp2PushPromise(push), {
    promisedStreamId: 2,
    fragment: bytes(30),
    paddingBytes: 1,
  });

  assert.throws(
    () => parseHttp2Priority(frame(HTTP2_FRAME_PRIORITY, 0, 7, bytes(0, 0, 0, 7, 0))),
    (error) =>
      error.errorCode === HTTP2_PROTOCOL_ERROR &&
      error.streamId === 7 &&
      /depends on itself/.test(error.message),
  );
  assert.throws(
    () => parseHttp2Data(frame(HTTP2_FRAME_DATA, HTTP2_FLAG_PADDED, 1, bytes(2, 0))),
    /padding exceeds/,
  );
});

test("control payloads preserve unsigned values and reject zero window progress", () => {
  const goAway = frame(
    HTTP2_FRAME_GOAWAY,
    0,
    0,
    encodeHttp2GoAway(0x7fffffff, 0xffffffff, bytes(1, 2, 3)),
  );
  assert.deepEqual(parseHttp2GoAway(goAway), {
    lastStreamId: 0x7fffffff,
    errorCode: 0xffffffff,
    debugData: bytes(1, 2, 3),
  });
  assert.equal(
    parseHttp2RstStream(frame(HTTP2_FRAME_RST_STREAM, 0, 1, encodeHttp2ErrorCode(0xffffffff))),
    0xffffffff,
  );
  assert.equal(
    parseHttp2WindowUpdate(
      frame(HTTP2_FRAME_WINDOW_UPDATE, 0, 0, encodeHttp2WindowUpdate(0x7fffffff)),
    ),
    0x7fffffff,
  );
  assert.throws(
    () => parseHttp2WindowUpdate(frame(HTTP2_FRAME_WINDOW_UPDATE, 0, 3, bytes(0, 0, 0, 0))),
    (error) => error.errorCode === HTTP2_PROTOCOL_ERROR && error.streamId === 3,
  );
});

test("known frame kinds enforce RFC 9113 stream and fixed-length rules", () => {
  const invalid = [
    frame(HTTP2_FRAME_DATA, 0, 0),
    frame(HTTP2_FRAME_HEADERS, 0, 0),
    frame(HTTP2_FRAME_PRIORITY, 0, 1, bytes(0, 0, 0, 0)),
    frame(HTTP2_FRAME_RST_STREAM, 0, 1, bytes(0, 0, 0)),
    frame(HTTP2_FRAME_PING, 0, 1, new Uint8Array(8)),
    frame(HTTP2_FRAME_PING, 0, 0, new Uint8Array(7)),
    frame(HTTP2_FRAME_GOAWAY, 0, 1, new Uint8Array(8)),
    frame(HTTP2_FRAME_GOAWAY, 0, 0, new Uint8Array(7)),
    frame(HTTP2_FRAME_WINDOW_UPDATE, 0, 0, new Uint8Array(3)),
    frame(HTTP2_FRAME_CONTINUATION, 0, 0),
  ];
  for (const value of invalid) {
    assert.throws(() => decodeHttp2Frame(encodeHttp2Frame(value)));
  }
});

test("header block assembler enforces CONTINUATION exclusivity and byte limits", () => {
  const assembler = new Http2HeaderBlockAssembler(4);
  assert.equal(
    assembler.accept(frame(HTTP2_FRAME_HEADERS, HTTP2_FLAG_END_STREAM, 1, bytes(1, 2))),
    null,
  );
  assert.deepEqual(
    assembler.accept(frame(HTTP2_FRAME_CONTINUATION, HTTP2_FLAG_END_HEADERS, 1, bytes(3, 4))),
    {
      kind: "headers",
      streamId: 1,
      endStream: true,
      promisedStreamId: null,
      priority: null,
      block: bytes(1, 2, 3, 4),
    },
  );

  assert.throws(
    () => new Http2HeaderBlockAssembler(4).accept(frame(HTTP2_FRAME_CONTINUATION, 0, 1)),
    /Unexpected/,
  );

  const interrupted = new Http2HeaderBlockAssembler(4);
  interrupted.accept(frame(HTTP2_FRAME_HEADERS, 0, 1, bytes(1)));
  assert.throws(
    () => interrupted.accept(frame(HTTP2_FRAME_PING, 0, 0, new Uint8Array(8))),
    (error) => error.errorCode === HTTP2_PROTOCOL_ERROR,
  );

  const wrongStream = new Http2HeaderBlockAssembler(4);
  wrongStream.accept(frame(HTTP2_FRAME_HEADERS, 0, 1, bytes(1)));
  assert.throws(
    () => wrongStream.accept(frame(HTTP2_FRAME_CONTINUATION, HTTP2_FLAG_END_HEADERS, 3, bytes(2))),
    /interrupted/,
  );

  const oversized = new Http2HeaderBlockAssembler(3);
  oversized.accept(frame(HTTP2_FRAME_HEADERS, 0, 1, bytes(1, 2)));
  assert.throws(
    () => oversized.accept(frame(HTTP2_FRAME_CONTINUATION, HTTP2_FLAG_END_HEADERS, 1, bytes(3, 4))),
    /configured limit/,
  );

  const tooFragmented = new Http2HeaderBlockAssembler(10, 2);
  tooFragmented.accept(frame(HTTP2_FRAME_HEADERS, 0, 1));
  tooFragmented.accept(frame(HTTP2_FRAME_CONTINUATION, 0, 1));
  assert.throws(
    () => tooFragmented.accept(frame(HTTP2_FRAME_CONTINUATION, HTTP2_FLAG_END_HEADERS, 1)),
    /too many fragments/,
  );
});

test("encoder and decoder enforce negotiated and absolute frame-size bounds", () => {
  assert.throws(
    () => encodeHttp2Frame(frame(0xaa, 0, 1, new Uint8Array(HTTP2_DEFAULT_FRAME_SIZE + 1))),
    /peer maximum/,
  );

  const accepted = encodeHttp2Frame(
    frame(0xaa, 0, 1, new Uint8Array(HTTP2_DEFAULT_FRAME_SIZE + 1)),
    HTTP2_DEFAULT_FRAME_SIZE + 1,
  );
  assert.equal(
    decodeHttp2Frame(accepted, HTTP2_DEFAULT_FRAME_SIZE + 1).payload.length,
    HTTP2_DEFAULT_FRAME_SIZE + 1,
  );
  assert.throws(
    () => decodeHttp2Frame(accepted),
    (error) => {
      assert.equal(error.errorCode, HTTP2_FRAME_SIZE_ERROR);
      return true;
    },
  );
});
