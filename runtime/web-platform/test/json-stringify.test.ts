// Serialization, against node.
//
// The central assertion is a round trip: for every valid input in the shared corpus,
// `stringify(parse(text))` must equal what node produces for the same text. That single
// comparison covers escaping, number formatting, key order and container syntax at once, and
// it fails for any of them — which is the point, since a serializer that is wrong about
// exactly one escape is otherwise very hard to catch by reading.
//
// The specific assertions after it are for the cases the round trip cannot reach: characters
// that never appear in the corpus, and the `space` argument, which has no parse-side input.
import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonText } from "../src/json/parse.ts";
import {
  quoteJSONString,
  resolveGap,
  stringifyJsonValue,
} from "../src/json/stringify.ts";
import { VALID } from "./json-corpus.ts";

const suite = (name: string, fn: () => void): void => {
  test(name, { timeout: 15000 }, fn);
};

suite("every valid input round-trips exactly as node serializes it", () => {
  for (const text of VALID) {
    const expected = JSON.stringify(JSON.parse(text));
    const actual = stringifyJsonValue(parseJsonText(text));
    assert.equal(actual, expected, `round trip of ${JSON.stringify(text)}`);
  }
});

suite("the indent argument matches node for every gap it accepts", () => {
  // `space` has no parse-side input, so the round trip above never exercises it.
  const gaps: (number | string)[] = [0, 1, 2, 4, 10, 11, 100, -1, 1.9, NaN, "", "\t", "ab", "0123456789X"];
  const shapes = [
    '{"a":1,"b":[1,2],"c":{"d":{"e":[]}}}',
    "[]",
    "{}",
    "[[],{},[{}]]",
    '{"a":{}}',
    "[1]",
  ];
  for (const space of gaps) {
    for (const text of shapes) {
      const expected = JSON.stringify(JSON.parse(text), null, space);
      const actual = stringifyJsonValue(parseJsonText(text), { gap: resolveGap(space) });
      assert.equal(actual, expected, `${JSON.stringify(text)} with space ${JSON.stringify(space)}`);
    }
  }
});

suite("Table 78 is exactly seven escapes, and the rest go through UnicodeEscape", () => {
  // The table holds `\b` `\t` `\n` `\f` `\r` `\"` `\\` and nothing else. Vertical tab is the
  // case that catches an implementation which assumed the C escape set: U+000B has no short
  // form here and must come out as a Unicode escape.
  assert.equal(quoteJSONString("\b\t\n\f\r"), '"\\b\\t\\n\\f\\r"');
  assert.equal(quoteJSONString('"'), '"\\""');
  assert.equal(quoteJSONString("\\"), '"\\\\"');
  assert.equal(quoteJSONString("\v"), '"\\u000b"');
  assert.equal(quoteJSONString("\0"), '"\\u0000"');
  assert.equal(quoteJSONString("\u001f"), '"\\u001f"');
  // A solidus is not in the table: the parser accepts `\/` and the serializer never writes it.
  assert.equal(quoteJSONString("/"), '"/"');
  for (const sample of ["\b\t\n\f\r", '"', "\\", "\v", "\0", "\u001f", "/", "a/b"]) {
    assert.equal(quoteJSONString(sample), JSON.stringify(sample), `node agrees for ${JSON.stringify(sample)}`);
  }
});

suite("a lone surrogate is escaped and a well-formed pair is not", () => {
  // The other half of the parser preserving one. Escaping the unpaired half and leaving the
  // pair alone is what makes text with an astral character survive a round trip while text
  // with a broken pair stays broken rather than becoming U+FFFD.
  assert.equal(quoteJSONString("\ud800"), '"\\ud800"');
  assert.equal(quoteJSONString("\udfff"), '"\\udfff"');
  assert.equal(quoteJSONString("\ud800a"), '"\\ud800a"');
  assert.equal(quoteJSONString("\udc00\ud800"), '"\\udc00\\ud800"');
  assert.equal(quoteJSONString("😀"), '"😀"');
  for (const sample of ["\ud800", "\udfff", "\ud800a", "\udc00\ud800", "😀", "a\ud800b"]) {
    assert.equal(quoteJSONString(sample), JSON.stringify(sample), `node agrees for ${escapeAll(sample)}`);
  }
});

suite("numbers use the canonical conversion, and non-finite ones become null", () => {
  // `1e400` is valid JSON, parses to Infinity, and serializes back to `null` -- so it is a
  // case that legitimately does not round-trip, and the corpus contains it for that reason.
  assert.equal(stringifyJsonValue(parseJsonText("1e400")), "null");
  assert.equal(stringifyJsonValue(parseJsonText("-1e400")), "null");
  assert.equal(stringifyJsonValue(parseJsonText("-0")), "0");
  assert.equal(stringifyJsonValue(parseJsonText("1e-400")), "0");
  // Shortest round-tripping, not `%.17g`: these are the values that separate the two.
  for (const text of ["0.1", "1e21", "1e-7", "5e-324", "1.7976931348623157e308", "123456789012345678"]) {
    assert.equal(
      stringifyJsonValue(parseJsonText(text)),
      JSON.stringify(JSON.parse(text)),
      `number formatting for ${text}`,
    );
  }
});

suite("deep nesting serializes without exhausting a native stack", () => {
  // The serializer carries an explicit frame stack for the same reason the parser does. A
  // recursive one dies here, and the plan requires that it not die on one target and survive
  // on another.
  const depth = 50000;
  const text = "[".repeat(depth) + "]".repeat(depth);
  assert.equal(stringifyJsonValue(parseJsonText(text)), text);
});

suite("an indented container puts its closing bracket at the outer indent", () => {
  // 25.5.4.5 and 25.5.4.6 place the *outer* indent before the closing brace and the inner one
  // before each member. Getting that backwards produces output that still parses, which is
  // why it is asserted against exact text rather than by re-parsing.
  assert.equal(
    stringifyJsonValue(parseJsonText('{"a":[1,{"b":2}]}'), { gap: resolveGap(2) }),
    '{\n  "a": [\n    1,\n    {\n      "b": 2\n    }\n  ]\n}',
  );
  assert.equal(stringifyJsonValue(parseJsonText('{"a":{}}'), { gap: resolveGap(2) }), '{\n  "a": {}\n}');
});

function escapeAll(value: string): string {
  let out = "";
  for (let at = 0; at < value.length; at++) {
    out += "\\u" + value.charCodeAt(at).toString(16).padStart(4, "0");
  }
  return out;
}
