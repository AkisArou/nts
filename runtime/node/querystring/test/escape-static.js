// `querystring.escape`, against node, on the cases that separate it from
// `encodeURIComponent`.
//
// The compiled `querystring` publishes exactly one name and it is node's:
// `escape`. The module records zero passes, because every upstream
// `test-querystring-*.js` needs `parse` or `stringify`, which do not compile
// yet.
//
// # It is not `encodeURIComponent`, and the cases below are where they part
//
// Node's `querystring.escape` has its own table. `encodeURIComponent` leaves
// `!'()*` alone; `escape` leaves `!` alone too but escapes others differently,
// and a `+` must come back as `%2B` rather than surviving, because a bare `+`
// means a space to the parser on the other side.
//
//     "a b"      a%20b        not "a+b" -- that is `stringify`'s job, not this
//     "a+b"      a%2Bb        the one that catches a table copied from the wrong
//                             function
//     "a=b&c"    a%3Db%26c    the delimiters, which is the whole point
//     "hi!"      hi!          unreserved, left alone
//     "é"   %C3%A9       UTF-8, two bytes, uppercase hex
//     ""         ""           the empty string is not a special case here
//
// Checked against `require("node:querystring").escape` directly before writing
// this, not read from the spec. The UTF-8 row is the one an implementation
// working in UTF-16 code units gets wrong, and the uppercase hex is the one a
// `toString(16)` without `.toUpperCase()` gets wrong.
//
// # Why the comparison is against node in-process
//
// `querystring` is the module under test, so `require("querystring")` is ours.
// `require("node:querystring")` resolves through the same shim. The oracle here
// is a **child** for that reason, as in `process/test/env-static.js`, and the
// binary comes from `/proc/self/exe` rather than `process.execPath`.
"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const { readlinkSync } = require("fs");
const querystring = require("querystring");

assert.strictEqual(typeof querystring.escape, "function", "querystring.escape is missing");

const CASES = ["a b", "a+b", "a=b&c", "hi!", "é", "", "*'()", "~-_.", "\u{1F600}"];

// Node's answers, from a child that is not going through our shim.
const nodeBinary = readlinkSync("/proc/self/exe");
const theirs = JSON.parse(execFileSync(
  nodeBinary,
  ["-p", "JSON.stringify(" + JSON.stringify(CASES) + ".map((s) => require('querystring').escape(s)))"],
  { encoding: "utf8" },
));

assert.strictEqual(theirs.length, CASES.length, "the child did not answer for every case");

for (let i = 0; i < CASES.length; i++) {
  assert.strictEqual(
    querystring.escape(CASES[i]),
    theirs[i],
    `escape(${JSON.stringify(CASES[i])}) is ${JSON.stringify(querystring.escape(CASES[i]))}, node's is ${JSON.stringify(theirs[i])}`,
  );
}

// And the two that a wrong table passes everything else on.
assert.strictEqual(querystring.escape("a+b"), "a%2Bb", "a plus must not survive");
assert.strictEqual(querystring.escape("é"), "%C3%A9", "UTF-8, uppercase hex");
