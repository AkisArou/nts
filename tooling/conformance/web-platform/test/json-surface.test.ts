// `JSON.parse` with a reviver, `JSON.stringify` with a replacer, and the raw-JSON pair.
//
// The reviver is compared with node on the two things that are hard to get right and easy to
// get plausibly wrong: the **order** values are offered in, and which of them carry a
// `source`. Both are recorded as a sequence on each side and compared, because a reviver that
// visits the right values in the wrong order transforms most documents identically.
import assert from "node:assert/strict";
import test from "node:test";

import {
  isRawJSON,
  jsonParse,
  jsonRawJSON,
  jsonStringify,
} from "../../../../runtime/web-platform/src/json/json.ts";
import { parseJsonText } from "../../../../runtime/web-platform/src/json/parse.ts";
import { JsonValue } from "../../../../runtime/web-platform/src/json/value.ts";
import { must, plain } from "./json-corpus.ts";

const suite = (name: string, fn: () => void): void => {
  test(name, { timeout: 15000 }, fn);
};

const SHAPES = [
  '{"a":1,"b":[1,2],"c":{"d":null}}',
  "[1,[2,[3]]]",
  '{"":0,"x":"y"}',
  "[]",
  "{}",
  '{"b":1,"0":2,"a":3}',
  '[{"a":[true,false]}]',
];

suite("a reviver sees the same values in the same order as node", () => {
  for (const text of SHAPES) {
    const theirs: string[] = [];
    JSON.parse(text, function (key, value) {
      theirs.push(`${key}:${Array.isArray(value) ? "array" : typeof value}`);
      return value;
    });
    const mine: string[] = [];
    jsonParse(text, (key, value) => {
      const shape = value.kind === "array" ? "array" : value.kind === "object" ? "object" : value.kind;
      mine.push(`${key}:${shape}`);
      return value;
    });
    // Node reports an object as "object" and an array as "array"; the graph names each kind,
    // so only the container words are normalised before comparing.
    const normalised = theirs.map((entry) =>
      entry
        .replace(/:object$/, ":object")
        .replace(/:number$/, ":number")
        .replace(/:string$/, ":string")
        .replace(/:boolean$/, ":boolean"),
    );
    const mineNormalised = mine.map((entry) => entry.replace(/:null$/, ":object"));
    assert.deepEqual(mineNormalised, normalised, `reviver order for ${text}`);
  }
});

suite("only a non-object carries a source, and it is its own text", () => {
  // 25.5.2.4 reaches the `source` branch only when the value is not an Object. Recording the
  // pairs on both sides catches both halves: a missing source on a primitive, and a source
  // invented for a container.
  for (const text of SHAPES) {
    const theirs: string[] = [];
    // The bundled lib types for `JSON.parse` predate the source-text proposal and declare a
    // two-parameter reviver, so the third argument is reached through a cast. The runtime has
    // it -- that is what this test is comparing against.
    type SourceReviver = (key: string, value: unknown, context: { source?: string }) => unknown;
    const parseWithSource = JSON.parse as unknown as (text: string, reviver: SourceReviver) => unknown;
    parseWithSource(text, (key, value, context) => {
      theirs.push(`${key}=${context.source ?? "-"}`);
      return value;
    });
    const mine: string[] = [];
    jsonParse(text, (key, value, context) => {
      mine.push(`${key}=${context.source ?? "-"}`);
      return value;
    });
    assert.deepEqual(mine, theirs, `sources for ${text}`);
  }
});

suite("an identity reviver leaves the document alone", () => {
  for (const text of SHAPES) {
    const revived = must(jsonParse(text, (_key, value) => value));
    assert.deepEqual(plain(revived), JSON.parse(text), `identity for ${text}`);
  }
});

suite("dropping an object key removes it", () => {
  const text = '{"a":1,"b":2,"c":3}';
  const revived = must(jsonParse(text, (key, value) => (key === "b" ? undefined : value)));
  assert.deepEqual(plain(revived), JSON.parse(text, (key, value) => (key === "b" ? undefined : value)));
  assert.deepEqual([...revived.keys], ["a", "c"]);
});

suite("dropping an array element leaves a hole, not a shorter array", () => {
  // 25.5.2.4 deletes rather than splices, so the array keeps its length and the gap
  // serializes as `null`. An implementation that removed the element produces `[1,3]`, which
  // is a different document and passes any test that only checks the surviving values.
  const text = "[1,2,3]";
  const drop = (key: string, value: unknown): unknown => (key === "1" ? undefined : value);
  const revived = must(jsonParse(text, (key, value) => (key === "1" ? undefined : value)));
  assert.equal(revived.items.length, 3);
  assert.equal(must(revived.items[1]).kind, "hole");
  assert.equal(jsonStringify(revived), JSON.stringify(JSON.parse(text, drop)));
  assert.equal(jsonStringify(revived), "[1,null,3]");
});

suite("a reviver replacing a value is reflected in its parent", () => {
  const text = '{"a":1,"b":{"c":2}}';
  const revived = must(
    jsonParse(text, (key, value) =>
      value.kind === "number" ? JsonValue.numberValue(value.number * 10, 0, 0) : value,
    ),
  );
  assert.deepEqual(
    plain(revived),
    JSON.parse(text, (_key, value) => (typeof value === "number" ? value * 10 : value)),
  );
});

suite("a replacer omits values, and an omitted array element becomes null", () => {
  const text = '{"a":1,"b":2,"c":[1,2,3]}';
  const mine = jsonStringify(parseJsonText(text), {
    replacer: (key, value) => (key === "b" || key === "1" ? undefined : value),
  });
  const theirs = JSON.stringify(JSON.parse(text), (key, value) =>
    key === "b" || key === "1" ? undefined : value,
  );
  assert.equal(mine, theirs);
  assert.equal(mine, '{"a":1,"c":[1,null,3]}');
});

suite("a replacer discarding the root produces no output at all", () => {
  assert.equal(jsonStringify(parseJsonText('{"a":1}'), { replacer: () => undefined }), undefined);
  assert.equal(JSON.stringify(JSON.parse('{"a":1}'), () => undefined), undefined);
});

suite("a property list selects keys and imposes its own order", () => {
  // 25.5.4.5 walks the list rather than the object, so the list decides the order too — which
  // is the half an implementation that filters the object's keys gets wrong.
  const text = '{"a":1,"b":2,"c":3}';
  for (const list of [["b", "a"], ["c"], [], ["a", "zz", "b"]]) {
    const mine = jsonStringify(parseJsonText(text), { propertyList: list });
    const theirs = JSON.stringify(JSON.parse(text), list);
    assert.equal(mine, theirs, `property list ${JSON.stringify(list)}`);
  }
});

suite("rawJSON emits its text verbatim and refuses anything that is not a primitive", () => {
  const raw = jsonRawJSON('{"a":1}'.slice(5, 6));
  assert.equal(isRawJSON(raw), true);
  assert.equal(jsonStringify(raw), "1");
  assert.equal(jsonStringify(jsonRawJSON("1e999")), "1e999", "the text is not re-formatted");
  assert.equal(jsonStringify(jsonRawJSON('"a\\u0041b"')), '"a\\u0041b"', "escapes are not rewritten");

  for (const bad of ["", " 1", "1 ", "[1]", "{}", "[", "+1", "-", "truer", "nul", "TRUE"]) {
    assert.throws(() => jsonRawJSON(bad), SyntaxError, `rawJSON accepted ${JSON.stringify(bad)}`);
  }
  for (const good of ["1", "-1", "1.5", "1e3", '""', '"a"', "true", "false", "null"]) {
    assert.equal(isRawJSON(jsonRawJSON(good)), true, `rawJSON rejected ${JSON.stringify(good)}`);
  }
});

suite("isRawJSON is false for everything the parser produces", () => {
  for (const text of ["1", '"a"', "true", "null", "[]", "{}"]) {
    assert.equal(isRawJSON(parseJsonText(text)), false, text);
  }
});

suite("a raw value nested in a document is spliced in unchanged", () => {
  const document = JsonValue.objectValue(
    ["a", "b"],
    [jsonRawJSON("1e999"), parseJsonText('"x"')],
    0,
    0,
  );
  assert.equal(jsonStringify(document), '{"a":1e999,"b":"x"}');
  assert.equal(jsonStringify(document, { space: 2 }), '{\n  "a": 1e999,\n  "b": "x"\n}');
});
