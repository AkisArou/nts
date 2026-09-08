// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// Deterministic protocol fuzzing.
//
// The plan lists fuzzing under testing and observability. The property under test is
// not "does it parse" -- malformed input is the point -- but that malformed input
// always reaches a *named* failure: a typed error from our own taxonomy, in bounded
// time, with nothing half-decoded escaping as a result.
//
// Seeded, so a failure is reproducible rather than a run nobody can repeat. The
// generator's own coverage is asserted, because a fuzzer that never produces the
// interesting shape passes forever while testing nothing.
import assert from "node:assert/strict";
import test from "node:test";

import { BufferedReader } from "../../../../runtime/web-platform/src/provider.ts";
// Internal error types: a test may name them, but they are not widened into the
// provider boundary just to be asserted on.
import {
  LimitError,
  ProtocolError,
} from "../../../../runtime/web-platform/src/core/errors.ts";
import { readFrame } from "../../../../runtime/web-platform/src/websocket/codec.ts";
import { readHeaderFields } from "../../../../runtime/web-platform/src/http1/parser.ts";

const suite = (name, fn) => test(name, { timeout: 30_000 }, fn);
const CRLF = String.fromCharCode(13, 10);

/** xorshift32: small, deterministic, and identical on every run. */
function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function bytesFrom(bytes) {
  const source = Uint8Array.from(bytes);
  let offset = 0;
  return {
    get closed() {
      return false;
    },
    async read(maxBytes) {
      if (offset >= source.length) return null;
      const end = Math.min(source.length, offset + maxBytes);
      const chunk = source.subarray(offset, end);
      offset = end;
      return chunk;
    },
    async write(data) {
      return data.length;
    },
    close() {},
  };
}

/**
 * A failure that names itself.
 *
 * Reaching the end of the input is a legitimate outcome for a truncated frame. Anything
 * else must be one of our protocol errors: a raw `TypeError` from indexing past an
 * array, or a `RangeError` from an allocation, would mean the parser fell over rather
 * than refused.
 */
function isNamedFailure(error) {
  if (error instanceof ProtocolError || error instanceof LimitError) return true;
  return error instanceof Error && /unexpected end|closed|EOF/i.test(error.message);
}

suite("malformed WebSocket frames always reach a named failure", async () => {
  const next = rng(0x5eed1234);
  const coverage = {
    accepted: 0,
    control: 0,
    reservedBits: 0,
    wrongMasking: 0,
    extendedLength: 0,
    hugeLength: 0,
  };
  let failures = 0;

  for (let iteration = 0; iteration < 4000; iteration++) {
    const length = 2 + (next() % 20);
    const bytes = [];
    for (let index = 0; index < length; index++) bytes.push(next() & 0xff);

    // Half the corpus is steered towards frame-shaped input, so the parser is reached
    // past its first byte rather than rejected immediately every time.
    if ((next() & 1) === 0) {
      const opcodes = [0x00, 0x01, 0x02, 0x08, 0x09, 0x0a, 0x03, 0x0b];
      bytes[0] = (next() & 1 ? 0x80 : 0x00) | opcodes[next() % opcodes.length];
      const lengths = [0, 5, 125, 126, 127];
      bytes[1] = (next() & 1 ? 0x80 : 0x00) | lengths[next() % lengths.length];
    }

    if ((bytes[0] & 0x70) !== 0) coverage.reservedBits += 1;
    if ((bytes[0] & 0x0f) >= 8) coverage.control += 1;
    if ((bytes[1] & 0x80) === 0) coverage.wrongMasking += 1;
    if ((bytes[1] & 0x7f) === 126) coverage.extendedLength += 1;
    if ((bytes[1] & 0x7f) === 127) coverage.hugeLength += 1;

    const reader = new BufferedReader(bytesFrom(bytes));
    try {
      // The server direction: a client must mask, so unmasked input is a real case.
      const frame = await readFrame(reader, true, 1 << 20, true);
      coverage.accepted += 1;
      // Anything accepted must be internally consistent.
      assert.ok(frame.payload instanceof Uint8Array);
      assert.ok([0, 1, 2, 8, 9, 10].includes(frame.opcode));
      if (frame.opcode >= 8) {
        assert.equal(frame.fin, true, "a control frame is never fragmented");
        assert.ok(frame.payload.length <= 125, "a control frame is never large");
      }
    } catch (error) {
      failures += 1;
      assert.ok(
        isNamedFailure(error),
        "iteration " + iteration + " produced an unnamed failure: " + String(error?.stack ?? error),
      );
    }
  }

  // The corpus reached every shape this test claims to exercise. Without this the whole
  // suite could pass while generating nothing but two random bytes.
  assert.ok(coverage.accepted > 0, "some frames must parse, or nothing was exercised");
  assert.ok(failures > 0, "some frames must fail, or nothing malformed was generated");
  for (const [name, count] of Object.entries(coverage)) {
    assert.ok(count > 0, "the generator never produced: " + name);
  }
});

suite("malformed HTTP/1 header blocks always reach a named failure", async () => {
  const next = rng(0x1234abcd);
  const limits = { maxHeaderBytes: 4096, maxHeaders: 32, maxInformational: 4 };
  const coverage = { accepted: 0, noColon: 0, spacedValue: 0, longLine: 0, manyFields: 0 };
  let failures = 0;

  for (let iteration = 0; iteration < 2000; iteration++) {
    const fields = next() % 6;
    let text = "";
    for (let index = 0; index < fields; index++) {
      const shape = next() % 5;
      if (shape === 0) text += "name" + index + ": value" + CRLF;
      else if (shape === 1) {
        text += "novalue" + index + CRLF;
        coverage.noColon += 1;
      } else if (shape === 2) {
        text += "bad" + index + ": va lue" + CRLF;
        coverage.spacedValue += 1;
      } else if (shape === 3) {
        text += "long" + index + ": " + "x".repeat(600) + CRLF;
        coverage.longLine += 1;
      } else {
        for (let extra = 0; extra < 40; extra++) text += "f" + extra + ": v" + CRLF;
        coverage.manyFields += 1;
      }
    }
    text += CRLF;

    const bytes = [];
    for (let index = 0; index < text.length; index++) bytes.push(text.charCodeAt(index) & 0xff);
    const reader = new BufferedReader(bytesFrom(bytes));
    try {
      const headers = await readHeaderFields(reader, limits);
      coverage.accepted += 1;
      assert.ok(Array.isArray(headers));
      assert.ok(headers.length <= limits.maxHeaders);
      for (const [name, value] of headers) {
        assert.equal(typeof name, "string");
        assert.equal(typeof value, "string");
        assert.ok(name.length > 0, "a parsed field always has a name");
      }
    } catch (error) {
      failures += 1;
      assert.ok(
        isNamedFailure(error),
        "iteration " + iteration + " produced an unnamed failure: " + String(error?.stack ?? error),
      );
    }
  }

  assert.ok(coverage.accepted > 0, "some header blocks must parse");
  assert.ok(failures > 0, "some header blocks must fail");
  for (const [name, count] of Object.entries(coverage)) {
    assert.ok(count > 0, "the generator never produced: " + name);
  }
});

suite("the corpus is the same on every run", () => {
  // A fuzzer whose corpus changes per run reports failures nobody can reproduce. Two
  // generators from one seed must agree exactly.
  const a = rng(99);
  const b = rng(99);
  for (let index = 0; index < 1000; index++) assert.equal(a(), b());
  // And different seeds must actually differ, or seeding is decoration.
  const c = rng(100);
  const d = rng(101);
  let differences = 0;
  for (let index = 0; index < 100; index++) if (c() !== d()) differences += 1;
  assert.ok(differences > 90, "different seeds must produce different corpora");
});
