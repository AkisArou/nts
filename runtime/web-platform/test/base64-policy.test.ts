import assert from "node:assert/strict";
import test from "node:test";
import { atob, btoa, DOMException } from "../src/index.ts";

// HTML §8.3: https://html.spec.whatwg.org/multipage/webappapis.html#atob
// Infra §7: https://infra.spec.whatwg.org/#forgiving-base64
// Web IDL: https://webidl.spec.whatwg.org/#es-DOMString
// These are source-policy controls, using explicit binary strings and base64
// vectors. Window/Worker receiver identity belongs to the provider bootstrap.
type StringOperation = (data?: unknown, ...ignored: unknown[]) => string;
const decode = atob as StringOperation;
const encode = btoa as StringOperation;

function invalidCharacter(action: () => unknown, message?: string): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof DOMException, "must use the package's DOMException");
    assert.equal(error.name, "InvalidCharacterError");
    assert.equal(error.code, DOMException.INVALID_CHARACTER_ERR);
    return true;
  }, message);
}

test("base64 encodes and decodes inputs of zero through four bytes exactly", () => {
  const vectors = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
  ] as const;
  for (const [binary, encoded] of vectors) {
    assert.equal(btoa(binary), encoded);
    const decoded = atob(encoded);
    assert.equal(decoded, binary);
    assert.equal(decoded.length, binary.length);
  }
});

test("base64 preserves all 256 Latin-1 bytes against a fixed encoded vector", () => {
  const binary = String.fromCharCode(...Array.from({ length: 256 }, (_, byte) => byte));
  const encoded =
    "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4" +
    "OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3Bx" +
    "cnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmq" +
    "q6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj" +
    "5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==";
  assert.equal(btoa(binary), encoded);
  assert.equal(atob(encoded), binary);
  assert.equal(atob(encoded).length, 256);
  assert.equal(atob(btoa(binary)), binary);
});

test("base64 treats strings as bytes without UTF-8 conversion or BOM handling", () => {
  assert.equal(btoa("\u00e9"), "6Q==");
  assert.equal(btoa("\u00ff"), "/w==");
  assert.equal(btoa("\x00\x80\xff"), "AID/");
  assert.equal(atob("6Q=="), "\u00e9");
  assert.equal(atob("w6k="), "\xc3\xa9");
  assert.equal(atob("77u/"), "\xef\xbb\xbf");
  assert.equal(atob("77+9"), "\xef\xbf\xbd");
  assert.equal(atob("/w=="), "\xff");
});

test("missing base64 arguments differ from an explicit undefined", () => {
  assert.throws(() => encode(), TypeError);
  assert.throws(() => decode(), TypeError);
  assert.equal(encode(undefined), "dW5kZWZpbmVk");
  invalidCharacter(() => decode(undefined));
});

// Web IDL creates regular operations as nonconstructor built-in functions:
// https://webidl.spec.whatwg.org/#dfn-create-operation-function
test("base64 operations reject construction before converting the input", () => {
  let conversions = 0;
  const input = {
    toString(): string {
      conversions++;
      return "YQ==";
    },
  };
  assert.throws(() => {
    // @ts-expect-error Deliberately test construction of a nonconstructor operation.
    new atob(input);
  }, TypeError);
  assert.equal(conversions, 0);
  assert.throws(() => {
    // @ts-expect-error Deliberately test construction of a nonconstructor operation.
    new btoa(input);
  }, TypeError);
  assert.equal(conversions, 0);
});

test("base64 converts non-string arguments using DOMString conversion", () => {
  assert.equal(encode(null), "bnVsbA==");
  assert.equal(encode(false), "ZmFsc2U=");
  assert.equal(encode(123), "MTIz");
  assert.equal(encode(123n), "MTIz");
  assert.equal(decode(null), "\x9e\xe9\x65");
  assert.equal(decode(1234), "\xd7\x6d\xf8");
});

for (const [name, operation, source, expected] of [
  ["btoa", encode, "\xff", "/w=="],
  ["atob", decode, "/w==", "\xff"],
] as const) {
  test(`${name} converts its input once with a string hint and ignores extra arguments`, () => {
    const observed: string[] = [];
    const input = {
      get [Symbol.toPrimitive]() {
        observed.push("get primitive conversion");
        return (hint: string): string => {
          observed.push(hint);
          return source;
        };
      },
      toString(): never { throw new Error("toString must not run after @@toPrimitive"); },
      valueOf(): never { throw new Error("valueOf must not run after @@toPrimitive"); },
    };
    const ignored = {
      [Symbol.toPrimitive](): never { throw new Error("extra argument must not be converted"); },
    };
    assert.equal(operation(input, ignored), expected);
    assert.deepEqual(observed, ["get primitive conversion", "string"]);
  });

  test(`${name} uses toString before valueOf when ordinary conversion needs a fallback`, () => {
    const observed: string[] = [];
    const input = {
      toString(): object {
        observed.push("toString");
        return {};
      },
      valueOf(): string {
        observed.push("valueOf");
        return source;
      },
    };
    assert.equal(operation(input), expected);
    assert.deepEqual(observed, ["toString", "valueOf"]);
  });

  test(`${name} rejects Symbols during DOMString conversion`, () => {
    assert.throws(() => operation(Symbol("input")), TypeError);
    assert.throws(() => operation({
      [Symbol.toPrimitive](): symbol { return Symbol("converted input"); },
    }), TypeError);
  });

  test(`${name} propagates the exact exception thrown during input conversion`, () => {
    const reason = {};
    assert.throws(() => operation({
      get [Symbol.toPrimitive](): never { throw reason; },
    }), (error: unknown) => error === reason);
    assert.throws(() => operation({
      toString(): never { throw reason; },
    }), (error: unknown) => error === reason);
  });
}

test("btoa rejects code points above U+00FF without truncating or replacing them", () => {
  for (const input of [
    "\u0100", "\u0141", "\u0109", "\u2000", "\uffff",
    "\ud800", "\udfff", "\ud83d\ude00", "\x00\u0100", "abc\u0100",
  ]) {
    invalidCharacter(() => btoa(input), JSON.stringify(input));
  }
});

test("atob rejects non-ASCII code points even when their low byte is valid base64", () => {
  for (const input of [
    "\u0141A==", "\u0151Q==", "\u0109YQ==", "YQ\u013d=",
    "\u00ff", "\u0100", "\ud800", "\udc00", "\ud83d\ude00",
  ]) {
    invalidCharacter(() => atob(input), JSON.stringify(input));
  }
});

test("atob removes each ASCII whitespace character before checking padding", () => {
  for (const whitespace of ["\t", "\n", "\f", "\r", " "]) {
    assert.equal(atob(whitespace), "");
    assert.equal(atob(`${whitespace}Y${whitespace}Q${whitespace}=${whitespace}=${whitespace}`), "a");
  }
  assert.equal(atob("\t\n\f\r Y Q = = \r\f\n\t"), "a");
  assert.equal(atob("\t\n\f\r "), "");
});

test("btoa encodes whitespace as ordinary binary data", () => {
  assert.equal(btoa("\t\n\f\r "), "CQoMDSA=");
  assert.equal(btoa("\u00a0"), "oA==");
});

test("atob does not discard vertical tab or Unicode whitespace", () => {
  for (const whitespace of [
    "\v", "\u0085", "\u00a0", "\u1680", "\u2000", "\u2007",
    "\u2028", "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
  ]) {
    invalidCharacter(() => atob(`Y${whitespace}Q==`), JSON.stringify(whitespace));
    invalidCharacter(() => atob(`${whitespace}YQ==`), JSON.stringify(whitespace));
  }
});

test("atob accepts the permitted padded and unpadded tails without extra output bytes", () => {
  const vectors = [
    ["", ""], ["AA", "\x00"], ["AA==", "\x00"],
    ["AAA", "\x00\x00"], ["AAA=", "\x00\x00"], ["AAAA", "\x00\x00\x00"],
    ["Zg", "f"], ["Zg==", "f"], ["Zm8", "fo"], ["Zm8=", "fo"],
    ["Zm9v", "foo"], ["Zm9vYg", "foob"], ["Zm9vYg==", "foob"],
  ] as const;
  for (const [encoded, binary] of vectors) {
    const result = atob(encoded);
    assert.equal(result, binary, encoded);
    assert.equal(result.length, binary.length, encoded);
  }
});

test("atob rejects misplaced, incomplete and excessive padding", () => {
  for (const input of [
    "=", "==", "===", "====", "A", "A=", "A==", "A===",
    "AA=", "AA===", "AA====", "AAA==", "AAAA=", "AAAA==", "AAAAA",
    "=AAA", "A=AA", "AA=A", "YQ=", "YQ====", "YQ==AAAA",
    "YQ==\x00", " Y Q = ", " Y Q = = = ",
  ]) {
    invalidCharacter(() => atob(input), JSON.stringify(input));
  }
});

test("atob rejects nonalphabet characters and the base64url alphabet", () => {
  for (const input of [
    "-w==", "_w==", "YQ-", "YQ_", "YQ.", "YQ*", "YQ,",
    "YQ:", "YQ;", "YQ!", "YQ\x00", "YQ\x7f",
  ]) {
    invalidCharacter(() => atob(input), JSON.stringify(input));
  }
});

test("atob discards nonzero trailing bits instead of requiring canonical padding bits", () => {
  for (const [encoded, binary] of [
    ["YR", "a"], ["YR==", "a"], ["Yf", "a"], ["Yf==", "a"],
    ["Zm9", "fo"], ["Zm9=", "fo"], ["//", "\xff"], ["//==", "\xff"],
    ["///", "\xff\xff"], ["///=", "\xff\xff"],
  ] as const) {
    assert.equal(atob(encoded), binary, encoded);
  }
});
