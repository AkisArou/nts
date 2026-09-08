"use strict";

// The class identity of every `ERR_*` a public call can throw.
//
// Node builds all of these from one factory in `lib/internal/errors.js`, so
// upstream `constructor`, `name`, `code`, the prototype chain and the own-key
// set cannot disagree between two error types. This profile has roughly a
// hundred separate classes, and they can.
//
// **Every one of them carried an extra own key.** `this.name = "TypeError"` in
// a class extending `TypeError` is redundant -- the name is already there
// through the prototype -- but assigning it makes it an *own* property, so
// `Object.keys(err)` was `code,name` where node's is `code`. Eighty-three
// assignments, all of them saying what the base already said. Three were kept:
// `AbortError` and `SystemError` genuinely differ from their base, and node
// makes those own too.
//
// **And one message comes from node's C++ rather than its template.**
// `fs.accessSync("/tmp", "x")` answers `mode must be int32 or null/undefined` --
// no quoted name, no "The ... argument" prefix, no "Received" suffix -- because
// `accessSync` hands `mode` straight to `binding.access`. Reproducing that
// through the template is not possible and should not be: the template is right
// about every case node builds in JavaScript. `ERR_INVALID_ARG_TYPE_BINDING` is
// the escape hatch for the ones it does not, so matching node here did not mean
// weakening the template.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const qs = require("node:querystring");
const util = require("node:util");
const os = require("node:os");

const EXPECTED = [
  ["fs.readFile/object-path", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"path\" argument must be of type string or an instance of Buffer or URL. Received an instance of Object"],
  ["fs.open/bad-flags", "TypeError|TypeError|ERR_INVALID_ARG_VALUE|true|false|code|The argument 'flags' is invalid. Received 'zzz'"],
  ["fs.writeFile/bad-encoding", "TypeError|TypeError|ERR_INVALID_ARG_VALUE|true|false|code|The argument 'encoding' is invalid encoding. Received 'nope'"],
  ["fs.access/bad-mode", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|mode must be int32 or null/undefined"],
  ["fs.chmod/bad-mode", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"mode\" argument must be of type number. Received an instance of Object"],
  ["fs.mkdir/bad-recursive", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"options.recursive\" property must be of type boolean. Received type number (1)"],
  ["path.join/number", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"path\" argument must be of type string. Received type number (1)"],
  ["path.resolve/object", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"paths[0]\" argument must be of type string. Received an instance of Object"],
  ["path.basename/bad-ext", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"suffix\" argument must be of type string. Received type number (1)"],
  ["util.inspect/bad-depth", "NO-THROW"],
  ["util.promisify/number", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"original\" argument must be of type function. Received type number (1)"],
  ["util.callbackify/number", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"original\" argument must be of type function. Received type number (1)"],
  ["os.setPriority/bad", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"priority\" argument must be of type number. Received type string ('x')"],
  ["os.getPriority/bad", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The \"pid\" argument must be of type number. Received type string ('x')"],
  ["buffer.alloc/negative", "RangeError|RangeError|ERR_OUT_OF_RANGE|false|true|code|The value of \"size\" is out of range. It must be >= 0 && <= 9007199254740991. Received -1"],
  ["buffer.alloc/huge", "RangeError|RangeError|ERR_OUT_OF_RANGE|false|true|code|The value of \"size\" is out of range. It must be >= 0 && <= 9007199254740991. Received 9_007_199_254_740_992"],
  ["buffer.from/boolean", "TypeError|TypeError|ERR_INVALID_ARG_TYPE|true|false|code|The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received type boolean (true)"],
  ["buffer.toString/bad-enc", "TypeError|TypeError|ERR_UNKNOWN_ENCODING|true|false|code|Unknown encoding: nope"],
  ["buffer.readUInt8/oob", "RangeError|RangeError|ERR_OUT_OF_RANGE|false|true|code|The value of \"offset\" is out of range. It must be >= 0 and <= 0. Received 5"],
  ["qs.stringify/bad-encoder", "NO-THROW"],
];

const rows = [];
const shape = (label, fn) => {
  try {
    fn();
    rows.push([label, "NO-THROW"]);
  } catch (e) {
    rows.push([label, [e.constructor.name, e.name, e.code, e instanceof TypeError,
      e instanceof RangeError, Object.keys(e).sort().join(","), e.message].join("|")]);
  }
};

shape("fs.readFile/object-path", () => fs.readFileSync({}));
shape("fs.open/bad-flags", () => fs.openSync("/tmp", "zzz"));
shape("fs.writeFile/bad-encoding", () => fs.writeFileSync("/tmp/nts-x", "a", "nope"));
shape("fs.access/bad-mode", () => fs.accessSync("/tmp", "x"));
shape("fs.chmod/bad-mode", () => fs.chmodSync("/tmp", {}));
shape("fs.mkdir/bad-recursive", () => fs.mkdirSync("/tmp/nts-x", { recursive: 1 }));
shape("path.join/number", () => path.join(1));
shape("path.resolve/object", () => path.resolve({}));
shape("path.basename/bad-ext", () => path.basename("a", 1));
shape("util.inspect/bad-depth", () => util.inspect({}, { depth: "x" }));
shape("util.promisify/number", () => util.promisify(1));
shape("util.callbackify/number", () => util.callbackify(1));
shape("os.setPriority/bad", () => os.setPriority(0, "x"));
shape("os.getPriority/bad", () => os.getPriority("x"));
shape("buffer.alloc/negative", () => Buffer.alloc(-1));
shape("buffer.alloc/huge", () => Buffer.alloc(2 ** 53));
shape("buffer.from/boolean", () => Buffer.from(true));
shape("buffer.toString/bad-enc", () => Buffer.from("a").toString("nope"));
shape("buffer.readUInt8/oob", () => Buffer.from("a").readUInt8(5));
shape("qs.stringify/bad-encoder", () => qs.stringify({ a: 1 }, "&", "=", { encodeURIComponent: 1 }));

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
