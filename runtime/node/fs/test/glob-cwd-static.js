// `globSync`'s `cwd` is not a validated path, and node is deliberate about that.
//
// `lib/internal/fs/glob.js` is one line: `this.#root = toPathIfFileURL(cwd) ?? '.'`. There is no
// null-byte check, and `??` means `null` is the same as absent. An unusable directory then yields
// nothing, because a glob that finds no matches is not an error — which is a different contract
// from the rest of `fs`, where a null byte in a path is `ERR_INVALID_ARG_VALUE`.
//
// Routing it through `getValidatedPath` diverged from node twice, and the differential found both
// on the same run:
//
//     cwd containing a NUL   node []   ours ERR_INVALID_ARG_VALUE
//     cwd: null              node []   ours ERR_INVALID_ARG_TYPE
//
// A non-string that is not a URL still fails on both sides — node reaches `readdir` and throws
// `ERR_INVALID_ARG_TYPE` from there, which is the same code from a different place — so the type
// check stays and only those two behaviours are node's.
//
// All nine cases below were read off node before they were written here.
"use strict";

require("../common");

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const NUL = String.fromCharCode(0);
const base = path.join(__dirname, "..", "..", "punycode");

// The control: a real directory must actually match something, or every assertion below would
// pass against a glob that never finds anything.
const found = fs.globSync("*.mjs", { cwd: base }).sort();
assert.ok(found.length > 0, "the fixture directory matched nothing, so the rest proves nothing");
assert.ok(found.includes("shape.mjs"), `expected shape.mjs among ${JSON.stringify(found)}`);

// The two node behaviours this pins.
assert.deepStrictEqual(fs.globSync("*.mjs", { cwd: base + NUL }), [],
  "a null byte in cwd must yield nothing, not throw");
assert.deepStrictEqual(fs.globSync("*.mjs", { cwd: null }), fs.globSync("*.mjs", { cwd: "." }),
  "cwd: null must mean the current directory, as `?? '.'` does");

// A directory that does not exist is not an error either.
assert.deepStrictEqual(fs.globSync("*.mjs", { cwd: path.join(base, "nope") }), []);

// **`""` means the current directory, not "nothing", and asserting `[]` here was a fixture bug.**
// `?? '.'` only replaces `null` and `undefined`; an empty string survives it and globs relative to
// wherever the process is. This first asserted `[]`, which held when run from the repository root
// and failed inside the suite — a fixture whose answer depended on the harness's working directory
// rather than on the code under test. Comparing the two spellings of "here" is the property that
// is actually true.
assert.deepStrictEqual(
  fs.globSync("*.mjs", { cwd: "" }).sort(),
  fs.globSync("*.mjs", { cwd: "." }).sort(),
  "an empty cwd must mean the current directory, as `?? '.'` leaves it alone",
);

// A file URL is converted, and answers the same as the path it names.
assert.deepStrictEqual(
  fs.globSync("*.mjs", { cwd: new URL(`file://${base}/`) }).sort(),
  found,
  "a file: URL cwd must resolve to the same directory",
);

// And the type check that node also applies, from wherever it applies it.
for (const bad of [5, {}, Buffer.from(base)]) {
  assert.throws(() => fs.globSync("*.mjs", { cwd: bad }), { code: "ERR_INVALID_ARG_TYPE" },
    `cwd: ${typeof bad} must be ERR_INVALID_ARG_TYPE`);
}
