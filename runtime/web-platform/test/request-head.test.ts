// Reading an inbound HTTP/1 request head.
//
// The mirror of the response reader, and until now the only implementation of it in
// this repository lived in a test harness -- which is the wrong place for the thing
// under test. An embedding server needs it before it can decide anything: whether to
// upgrade, which host was asked for, whether the framing is one it can accept.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import {
  BufferedReader,
  defaultHeadLimits,
  readRequestHead,
} from "../src/provider.ts";
import type { ByteConnection } from "../src/provider/primitives.ts";
import type { HeadLimits, RequestHead } from "../src/http1/parser.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const CRLF = String.fromCharCode(13, 10);
const encoder = new TextEncoder();

/** A ByteConnection over a fixed script, one chunk at a time. */
function connectionOf(text: string, chunkSize = 64): ByteConnection {
  const bytes = encoder.encode(text);
  let offset = 0;
  return {
    get closed() {
      return offset >= bytes.length;
    },
    async read(maxBytes: number): Promise<Uint8Array | null> {
      if (offset >= bytes.length) return null;
      const take = Math.min(maxBytes, chunkSize, bytes.length - offset);
      const chunk = bytes.subarray(offset, offset + take);
      offset += take;
      return chunk;
    },
    async write(data: Uint8Array): Promise<number> {
      return data.length;
    },
    close() {
      offset = bytes.length;
    },
  };
}

// `chunkSize` is optional rather than merely defaulted-past: it sits after a parameter with a
// default, so leaving it bare made it *required* and every one-argument call a type error.
const read = (
  text: string,
  limits: HeadLimits = defaultHeadLimits,
  chunkSize?: number,
): Promise<RequestHead> =>
  readRequestHead(new BufferedReader(connectionOf(text, chunkSize)), limits);

const request = (line: string, headers: readonly string[] = []): string =>
  [line, ...headers, "", ""].join(CRLF);

suite("a request line and its fields are read", async () => {
  const head = await read(
    request("GET /path?query=1 HTTP/1.1", ["Host: example.test", "X-Odd:   spaced   "]),
  );
  assert.equal(head.method, "GET");
  assert.equal(head.target, "/path?query=1");
  assert.equal(head.version, "1.1");
  assert.deepEqual(head.headers, [
    ["host", "example.test"],
    ["x-odd", "spaced"],
  ]);
});

suite("HTTP/1.0 is read and reported as itself", async () => {
  const head = await read(request("HEAD / HTTP/1.0"));
  assert.equal(head.version, "1.0");
  assert.equal(head.method, "HEAD");
});

suite("the target is returned exactly as it arrived", async () => {
  // Normalising here would put a URL policy inside a framing parser, and a server that
  // routes on a normalised target while logging the original is how the two disagree.
  for (const target of [
    "//a/../b",
    "/%2e%2e/",
    "/a//b",
    "http://origin.test/absolute",
    "*",
    "/" + "x".repeat(200),
  ]) {
    const head = await read(request(`GET ${target} HTTP/1.1`));
    assert.equal(head.target, target);
  }
});

suite("a chunk boundary in the middle of the line changes nothing", async () => {
  // One byte at a time: the reader has to reassemble the line rather than assume a
  // request arrives in one packet, which on a real socket it frequently does not.
  const head = await read(
    request("POST /submit HTTP/1.1", ["Host: example.test"]),
    defaultHeadLimits,
    1,
  );
  assert.equal(head.method, "POST");
  assert.equal(head.target, "/submit");
  assert.deepEqual(head.headers, [["host", "example.test"]]);
});

suite("a malformed request line is refused", async () => {
  const malformed = [
    "GET",
    "GET /",
    "GET  HTTP/1.1",
    " /path HTTP/1.1",
    "/path HTTP/1.1",
    "GET /path HTTP/1.1 extra",
    "GET /path HTTP/2.0",
    "GET /path HTTP/1.2",
    "GET /path HTTPS/1.1",
    "GET /path HTTP/11",
    "GET /path http/1.1",
  ];
  for (const line of malformed) {
    await assert.rejects(() => read(request(line)), line);
  }
});

suite("a method that is not a token is refused", async () => {
  // Written as escapes rather than the bytes themselves: a case a reader cannot see
  // is a case nobody can check, and several of these were invisible in the first draft.
  for (const method of ["GE T", "GET/", 'GE"T', "GET\u0080", "GET\u0000"]) {
    await assert.rejects(() => read(request(`${method} / HTTP/1.1`)), method);
  }
});

suite("a target outside visible ASCII is refused", async () => {
  // Written as escapes rather than the bytes themselves: a case a reader cannot see
  // is a case nobody can check, and several of these were invisible in the first draft.
  for (const target of ["/a\u0000b", "/a\u007fb", "/\u00e9", "/a b", "/a\u0080"]) {
    await assert.rejects(() => read(request(`GET ${target} HTTP/1.1`)), target);
  }
});

suite("header limits are enforced", async () => {
  const many: string[] = [];
  for (let index = 0; index < 200; index++) many.push(`x-${index}: v`);
  await assert.rejects(
    () => read(request("GET / HTTP/1.1", many), { ...defaultHeadLimits, maxHeaderBytes: 65536, maxHeaders: 8 }),
    { name: "LimitError" },
  );
  await assert.rejects(
    () => read(request("GET / HTTP/1.1", ["x-long: " + "v".repeat(500)]), {
      ...defaultHeadLimits,
      maxHeaderBytes: 128,
      maxHeaders: 64,
    }),
    { name: "LimitError" },
  );
});

suite("a truncated head does not resolve as a whole one", async () => {
  const reader = new BufferedReader(connectionOf("GET / HTTP/1.1" + CRLF + "Host: a.test"));
  await assert.rejects(() => readRequestHead(reader));
});
