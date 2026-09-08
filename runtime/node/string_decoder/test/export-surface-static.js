// `string_decoder` publishes one name, and it is a class.
//
// The whole module is `StringDecoder`. It compiles today and publishes **zero**
// exports, so this file cannot run against the addon at all -- `shape.mjs`
// cannot build a surface from nothing. It is written now so that the day
// `export-class` lands, the first question has an answer that is not "some of
// its five files pass".
//
// The trap this avoids is the one `path` documents from the other side: a shape
// shim manufactures the key names, so a test that checked names would pass
// vacuously. Only the values carry information, and node's values come from a
// child `node -p` -- inside this harness `require("node:string_decoder")` and
// `require("string_decoder")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const stringDecoder = require("string_decoder");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:string_decoder")).sort()');
assert.ok(
  expected.length >= 1,
  `node's string_decoder exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(stringDecoder));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `missing name(s) node has: ${missing.join(", ")}`);

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(extra, [], `publishes name(s) node does not: ${extra.join(", ")}`);

assert.strictEqual(typeof stringDecoder.StringDecoder, "function");

// A class, not a function of the right type. Constructed, and the prototype
// members node has are all present -- a published constructor whose `write` had
// not survived would satisfy every check above.
const nodeProto = fromRealNode(
  'Object.getOwnPropertyNames(require("node:string_decoder").StringDecoder.prototype).sort()',
);
assert.ok(nodeProto.length >= 3, "node's StringDecoder.prototype looks empty");
const ourProto = stringDecoder.StringDecoder.prototype;
assert.strictEqual(typeof ourProto, "object");
const missingMembers = nodeProto.filter((name) => !(name in ourProto));
assert.deepStrictEqual(
  missingMembers,
  [],
  `StringDecoder.prototype is missing: ${missingMembers.join(", ")}`,
);

// And that it decodes across a split multi-byte sequence, which is the whole
// reason the class holds state. A constructor that returned a fresh object per
// call would pass the surface checks and fail here.
const decoder = new stringDecoder.StringDecoder("utf8");
const euro = Buffer.from("€", "utf8");
assert.strictEqual(decoder.write(euro.subarray(0, 2)), "");
assert.strictEqual(decoder.write(euro.subarray(2)), "€");
assert.strictEqual(decoder.end(), "");
