// `require('path/posix')` is `path.posix`, and the upstream form of that
// assertion passes with no module at all.
//
// `test-path-posix-exists.js` is three lines:
//
//     assert.strictEqual(require('path/posix'), require('path').posix);
//
// Under `--empty-exports` both sides are `undefined`, `undefined === undefined`
// holds, and the file passes. It was one of five hollow passes on the compiled
// axis, and the only lane that catches it is `--empty-exports` -- `--sabotage`
// fails it for an unrelated reason (the subpath stops resolving) and
// `--mutate-addon` cannot see it at all, because there is no behaviour here to
// destroy.
//
// This file keeps the upstream assertion and puts something in front of it that
// an absent module cannot satisfy: the subpath has to resolve to an object, and
// that object has to carry a working `join`. Identity between two things that
// exist is the invariant; identity between two absences is not.
//
// `namespace-identity-static.js` is the neighbouring file and a different
// question -- it walks the `posix`/`win32` graph reachable from the main export
// and never mentions the subpath specifiers.
"use strict";

require("../common");

const assert = require("assert");
const path = require("path");

for (const variant of ["posix", "win32"]) {
  const subpath = require(`path/${variant}`);

  // An absent module fails here, which is the whole point of the file.
  assert.strictEqual(
    typeof subpath,
    "object",
    `require('path/${variant}') is not an object`,
  );
  assert.notStrictEqual(subpath, null, `require('path/${variant}') is null`);

  // And an empty object fails here: the namespace has to be able to do the work.
  assert.strictEqual(
    typeof subpath.join,
    "function",
    `require('path/${variant}').join is not a function`,
  );
  const joined = subpath.join("a", "b");
  assert.strictEqual(
    typeof joined,
    "string",
    `require('path/${variant}').join did not return a string`,
  );
  assert.ok(
    joined.includes("a") && joined.includes("b"),
    `require('path/${variant}').join lost its arguments: ${joined}`,
  );

  // The upstream assertion, retained verbatim in meaning.
  assert.strictEqual(
    subpath,
    path[variant],
    `require('path/${variant}') is not path.${variant}`,
  );
}
