// The whole of `path`'s public surface, and both of its namespaces.
//
// Written while `path` compiled is 4 of 17 exports and 2 of 21 test files, on
// purpose. Eleven functions are absent from the addon because they call
// `validateString`, and none of the module's own tests says so: they call
// `path.join(...)` and fail with a TypeError about `undefined`, which reads as a
// behaviour bug in whichever assertion happened to run first rather than as a
// missing export.
//
// So this file exists to make the *shape* of the failure legible before it is
// fixed, and to prove the shape is gone afterwards. That second half is the one
// that matters: when the export table fills, every other test in this module
// starts passing for reasons this one cannot see, and a green sheet would not
// distinguish "seventeen exports" from "the fourteen the tests happened to
// reach".
//
// `punycode` is the cautionary case. It was carried for a long time as missing
// `version`; it was not, and no test could have told anyone either way because
// node ships two files here and neither enumerates anything.

"use strict";
const assert = require("assert");
const path = require("path");

// Sorted list rather than per-name checks, so an *added* export fails too. A
// name we publish and node does not is a divergence in the same way a missing
// one is, and it is the direction nobody looks.
const expected = [
  "_makeLong", "basename", "delimiter", "dirname", "extname", "format",
  "isAbsolute", "join", "matchesGlob", "normalize", "parse", "posix",
  "relative", "resolve", "sep", "toNamespacedPath", "win32",
];
assert.deepStrictEqual(Object.keys(path).sort(), expected);

const functions = [
  "_makeLong", "basename", "dirname", "extname", "format", "isAbsolute",
  "join", "matchesGlob", "normalize", "parse", "relative", "resolve",
  "toNamespacedPath",
];
// Collected, not asserted in the loop. Asserting here reported `format` and
// stopped -- which hid every check below it, including the one that finds
// `path.posix.sep` undefined. The compiler lane flagged exactly that: a test
// whose real finding sits behind an earlier one in the same file.
const findings = [];
for (const name of functions) {
  if (typeof path[name] !== "function") {
    findings.push(`path.${name} is ${typeof path[name]}, node's is function`);
  }
}

// The two scalars. `sep` and `delimiter` are string constants, which is the
// export kind the backend was dropping this morning for numbers -- a literal
// folded into its readers leaves nothing for the export table to name. These
// two survived because strings were unaffected, and pinning them means a change
// to how constants are published cannot quietly take them away.
assert.strictEqual(path.sep, "/");
assert.strictEqual(path.delimiter, ":");

// Both namespaces, each carrying the same function set as the top level minus
// the namespaces themselves. On a posix host `path.normalize` *is*
// `path.posix.normalize`, and `path.win32` is still reachable, because a program
// that manipulates Windows paths should not have to run on Windows.
for (const ns of ["posix", "win32"]) {
  if (typeof path[ns] !== "object" || path[ns] === null) {
    findings.push(`path.${ns} is ${typeof path[ns]}, node's is object`);
    continue;
  }
  for (const name of functions) {
    if (typeof path[ns][name] !== "function") {
      findings.push(`path.${ns}.${name} is ${typeof path[ns][name]}`);
    }
  }
  if (typeof path[ns].sep !== "string") {
    findings.push(`path.${ns}.sep is ${typeof path[ns].sep}, node's is a string`);
  }
  if (typeof path[ns].delimiter !== "string") {
    findings.push(`path.${ns}.delimiter is ${typeof path[ns].delimiter}, node's is a string`);
  }
}

// And that the two namespaces are actually different implementations rather
// than one object exported twice -- which would satisfy every check above.
for (const [label, got, want] of [
  ["path.posix.sep", path.posix && path.posix.sep, "/"],
  ["path.win32.sep", path.win32 && path.win32.sep, "\\"],
  ["path.posix.join(\"a\", \"b\")", path.posix && typeof path.posix.join === "function" ? path.posix.join("a", "b") : undefined, "a/b"],
  ["path.win32.join(\"a\", \"b\")", path.win32 && typeof path.win32.join === "function" ? path.win32.join("a", "b") : undefined, "a\\b"],
]) {
  if (got !== want) findings.push(`${label} is ${JSON.stringify(got)}, node's is ${JSON.stringify(want)}`);
}

// Every finding at once, so none hides the others.
assert.deepStrictEqual(
  findings,
  [],
  `${findings.length} surface finding(s):\n  ${findings.join("\n  ")}`,
);

// On this host the top level is the posix half, which is node's arrangement and
// is the thing `namespace-identity-static.js` covers from the other direction.
assert.strictEqual(path.sep, path.posix.sep);
