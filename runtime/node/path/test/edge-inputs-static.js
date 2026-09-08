"use strict";

// `path` against the inputs that have no obvious right answer.
//
// Node's `path` is pure string manipulation with no syscalls, so upstream a
// normaliser either implements the algorithm or does not, and there is one of
// it. Here there are two -- `posix` and `win32` -- reached through a namespace
// re-export, and each function walks the string itself.
//
// 182 cases: every one of `normalize`, `dirname`, `basename`, `extname`,
// `isAbsolute` and `parse` against 25 inputs, plus `join` and `relative` pairs.
// The inputs are the ones where the answer is a decision rather than a
// derivation -- the empty string, ".", "..", "//", "///", a trailing slash,
// "a/..", "/a/../.." climbing above the root, an embedded NUL, a leading and a
// trailing space, a backslash, a drive letter and a UNC path on posix.
//
// **`relative` is given two absolute paths on purpose.** With a relative operand
// it resolves against `process.cwd()`, and the oracle run and the module run do
// not share a working directory -- those rows differed by the length of a path
// prefix and nothing else, which is a difference that is not a defect. Both
// operands absolute makes it a pure function of its arguments.
//
// Every expected value read off node v24.20.0.

const assert = require("node:assert");
const path = require("node:path");

const EXPECTED = [
  ["normalize/\"\"", "\".\""],
  ["dirname/\"\"", "\".\""],
  ["basename/\"\"", "\"\""],
  ["extname/\"\"", "\"\""],
  ["isAbsolute/\"\"", "false"],
  ["parse/\"\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"\",\"ext\":\"\",\"name\":\"\"}"],
  ["normalize/\".\"", "\".\""],
  ["dirname/\".\"", "\".\""],
  ["basename/\".\"", "\".\""],
  ["extname/\".\"", "\"\""],
  ["isAbsolute/\".\"", "false"],
  ["parse/\".\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\".\",\"ext\":\"\",\"name\":\".\"}"],
  ["normalize/\"..\"", "\"..\""],
  ["dirname/\"..\"", "\".\""],
  ["basename/\"..\"", "\"..\""],
  ["extname/\"..\"", "\"\""],
  ["isAbsolute/\"..\"", "false"],
  ["parse/\"..\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"..\",\"ext\":\"\",\"name\":\"..\"}"],
  ["normalize/\"/\"", "\"/\""],
  ["dirname/\"/\"", "\"/\""],
  ["basename/\"/\"", "\"\""],
  ["extname/\"/\"", "\"\""],
  ["isAbsolute/\"/\"", "true"],
  ["parse/\"/\"", "{\"root\":\"/\",\"dir\":\"/\",\"base\":\"\",\"ext\":\"\",\"name\":\"\"}"],
  ["normalize/\"//\"", "\"/\""],
  ["dirname/\"//\"", "\"/\""],
  ["basename/\"//\"", "\"\""],
  ["extname/\"//\"", "\"\""],
  ["isAbsolute/\"//\"", "true"],
  ["parse/\"//\"", "{\"root\":\"/\",\"dir\":\"/\",\"base\":\"\",\"ext\":\"\",\"name\":\"\"}"],
  ["normalize/\"///\"", "\"/\""],
  ["dirname/\"///\"", "\"/\""],
  ["basename/\"///\"", "\"\""],
  ["extname/\"///\"", "\"\""],
  ["isAbsolute/\"///\"", "true"],
  ["parse/\"///\"", "{\"root\":\"/\",\"dir\":\"/\",\"base\":\"\",\"ext\":\"\",\"name\":\"\"}"],
  ["normalize/\"a//b\"", "\"a/b\""],
  ["dirname/\"a//b\"", "\"a/\""],
  ["basename/\"a//b\"", "\"b\""],
  ["extname/\"a//b\"", "\"\""],
  ["isAbsolute/\"a//b\"", "false"],
  ["parse/\"a//b\"", "{\"root\":\"\",\"dir\":\"a/\",\"base\":\"b\",\"ext\":\"\",\"name\":\"b\"}"],
  ["normalize/\"a/./b\"", "\"a/b\""],
  ["dirname/\"a/./b\"", "\"a/.\""],
  ["basename/\"a/./b\"", "\"b\""],
  ["extname/\"a/./b\"", "\"\""],
  ["isAbsolute/\"a/./b\"", "false"],
  ["parse/\"a/./b\"", "{\"root\":\"\",\"dir\":\"a/.\",\"base\":\"b\",\"ext\":\"\",\"name\":\"b\"}"],
  ["normalize/\"a/../b\"", "\"b\""],
  ["dirname/\"a/../b\"", "\"a/..\""],
  ["basename/\"a/../b\"", "\"b\""],
  ["extname/\"a/../b\"", "\"\""],
  ["isAbsolute/\"a/../b\"", "false"],
  ["parse/\"a/../b\"", "{\"root\":\"\",\"dir\":\"a/..\",\"base\":\"b\",\"ext\":\"\",\"name\":\"b\"}"],
  ["normalize/\"../a\"", "\"../a\""],
  ["dirname/\"../a\"", "\"..\""],
  ["basename/\"../a\"", "\"a\""],
  ["extname/\"../a\"", "\"\""],
  ["isAbsolute/\"../a\"", "false"],
  ["parse/\"../a\"", "{\"root\":\"\",\"dir\":\"..\",\"base\":\"a\",\"ext\":\"\",\"name\":\"a\"}"],
  ["normalize/\"/../a\"", "\"/a\""],
  ["dirname/\"/../a\"", "\"/..\""],
  ["basename/\"/../a\"", "\"a\""],
  ["extname/\"/../a\"", "\"\""],
  ["isAbsolute/\"/../a\"", "true"],
  ["parse/\"/../a\"", "{\"root\":\"/\",\"dir\":\"/..\",\"base\":\"a\",\"ext\":\"\",\"name\":\"a\"}"],
  ["normalize/\"a/b/\"", "\"a/b/\""],
  ["dirname/\"a/b/\"", "\"a\""],
  ["basename/\"a/b/\"", "\"b\""],
  ["extname/\"a/b/\"", "\"\""],
  ["isAbsolute/\"a/b/\"", "false"],
  ["parse/\"a/b/\"", "{\"root\":\"\",\"dir\":\"a\",\"base\":\"b\",\"ext\":\"\",\"name\":\"b\"}"],
  ["normalize/\"a/b//\"", "\"a/b/\""],
  ["dirname/\"a/b//\"", "\"a\""],
  ["basename/\"a/b//\"", "\"b\""],
  ["extname/\"a/b//\"", "\"\""],
  ["isAbsolute/\"a/b//\"", "false"],
  ["parse/\"a/b//\"", "{\"root\":\"\",\"dir\":\"a\",\"base\":\"b\",\"ext\":\"\",\"name\":\"b\"}"],
  ["normalize/\"./\"", "\"./\""],
  ["dirname/\"./\"", "\".\""],
  ["basename/\"./\"", "\".\""],
  ["extname/\"./\"", "\"\""],
  ["isAbsolute/\"./\"", "false"],
  ["parse/\"./\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\".\",\"ext\":\"\",\"name\":\".\"}"],
  ["normalize/\"../\"", "\"../\""],
  ["dirname/\"../\"", "\".\""],
  ["basename/\"../\"", "\"..\""],
  ["extname/\"../\"", "\"\""],
  ["isAbsolute/\"../\"", "false"],
  ["parse/\"../\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"..\",\"ext\":\"\",\"name\":\"..\"}"],
  ["normalize/\"a/..\"", "\".\""],
  ["dirname/\"a/..\"", "\"a\""],
  ["basename/\"a/..\"", "\"..\""],
  ["extname/\"a/..\"", "\"\""],
  ["isAbsolute/\"a/..\"", "false"],
  ["parse/\"a/..\"", "{\"root\":\"\",\"dir\":\"a\",\"base\":\"..\",\"ext\":\"\",\"name\":\"..\"}"],
  ["normalize/\"a/../..\"", "\"..\""],
  ["dirname/\"a/../..\"", "\"a/..\""],
  ["basename/\"a/../..\"", "\"..\""],
  ["extname/\"a/../..\"", "\"\""],
  ["isAbsolute/\"a/../..\"", "false"],
  ["parse/\"a/../..\"", "{\"root\":\"\",\"dir\":\"a/..\",\"base\":\"..\",\"ext\":\"\",\"name\":\"..\"}"],
  ["normalize/\"/a/../..\"", "\"/\""],
  ["dirname/\"/a/../..\"", "\"/a/..\""],
  ["basename/\"/a/../..\"", "\"..\""],
  ["extname/\"/a/../..\"", "\"\""],
  ["isAbsolute/\"/a/../..\"", "true"],
  ["parse/\"/a/../..\"", "{\"root\":\"/\",\"dir\":\"/a/..\",\"base\":\"..\",\"ext\":\"\",\"name\":\"..\"}"],
  ["normalize/\"\\u0000\"", "\"\\u0000\""],
  ["dirname/\"\\u0000\"", "\".\""],
  ["basename/\"\\u0000\"", "\"\\u0000\""],
  ["extname/\"\\u0000\"", "\"\""],
  ["isAbsolute/\"\\u0000\"", "false"],
  ["parse/\"\\u0000\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"\\u0000\",\"ext\":\"\",\"name\":\"\\u0000\"}"],
  ["normalize/\"a\\u0000b\"", "\"a\\u0000b\""],
  ["dirname/\"a\\u0000b\"", "\".\""],
  ["basename/\"a\\u0000b\"", "\"a\\u0000b\""],
  ["extname/\"a\\u0000b\"", "\"\""],
  ["isAbsolute/\"a\\u0000b\"", "false"],
  ["parse/\"a\\u0000b\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"a\\u0000b\",\"ext\":\"\",\"name\":\"a\\u0000b\"}"],
  ["normalize/\" \"", "\" \""],
  ["dirname/\" \"", "\".\""],
  ["basename/\" \"", "\" \""],
  ["extname/\" \"", "\"\""],
  ["isAbsolute/\" \"", "false"],
  ["parse/\" \"", "{\"root\":\"\",\"dir\":\"\",\"base\":\" \",\"ext\":\"\",\"name\":\" \"}"],
  ["normalize/\"a \"", "\"a \""],
  ["dirname/\"a \"", "\".\""],
  ["basename/\"a \"", "\"a \""],
  ["extname/\"a \"", "\"\""],
  ["isAbsolute/\"a \"", "false"],
  ["parse/\"a \"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"a \",\"ext\":\"\",\"name\":\"a \"}"],
  ["normalize/\" a\"", "\" a\""],
  ["dirname/\" a\"", "\".\""],
  ["basename/\" a\"", "\" a\""],
  ["extname/\" a\"", "\"\""],
  ["isAbsolute/\" a\"", "false"],
  ["parse/\" a\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\" a\",\"ext\":\"\",\"name\":\" a\"}"],
  ["normalize/\"a\\\\b\"", "\"a\\\\b\""],
  ["dirname/\"a\\\\b\"", "\".\""],
  ["basename/\"a\\\\b\"", "\"a\\\\b\""],
  ["extname/\"a\\\\b\"", "\"\""],
  ["isAbsolute/\"a\\\\b\"", "false"],
  ["parse/\"a\\\\b\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"a\\\\b\",\"ext\":\"\",\"name\":\"a\\\\b\"}"],
  ["normalize/\"C:\\\\a\"", "\"C:\\\\a\""],
  ["dirname/\"C:\\\\a\"", "\".\""],
  ["basename/\"C:\\\\a\"", "\"C:\\\\a\""],
  ["extname/\"C:\\\\a\"", "\"\""],
  ["isAbsolute/\"C:\\\\a\"", "false"],
  ["parse/\"C:\\\\a\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"C:\\\\a\",\"ext\":\"\",\"name\":\"C:\\\\a\"}"],
  ["normalize/\"\\\\\\\\server\\\\share\"", "\"\\\\\\\\server\\\\share\""],
  ["dirname/\"\\\\\\\\server\\\\share\"", "\".\""],
  ["basename/\"\\\\\\\\server\\\\share\"", "\"\\\\\\\\server\\\\share\""],
  ["extname/\"\\\\\\\\server\\\\share\"", "\"\""],
  ["isAbsolute/\"\\\\\\\\server\\\\share\"", "false"],
  ["parse/\"\\\\\\\\server\\\\share\"", "{\"root\":\"\",\"dir\":\"\",\"base\":\"\\\\\\\\server\\\\share\",\"ext\":\"\",\"name\":\"\\\\\\\\server\\\\share\"}"],
  ["join/\"\",\"\"", "\".\""],
  ["join/\"a\",\"\"", "\"a\""],
  ["join/\"\",\"b\"", "\"b\""],
  ["join/\"/a\",\"b\"", "\"/a/b\""],
  ["join/\"a\",\"/b\"", "\"a/b\""],
  ["join/\"a/\",\"/b\"", "\"a/b\""],
  ["join/\".\",\".\"", "\".\""],
  ["join/\"..\",\"..\"", "\"../..\""],
  ["join/\"/\",\"/\"", "\"/\""],
  ["join/\"a\",\"../b\"", "\"b\""],
  ["relative/\"/\",\"/\"", "\"\""],
  ["relative/\"/a\",\"/b\"", "\"../b\""],
  ["relative/\"/a/b\",\"/a/c\"", "\"../c\""],
  ["relative/\"/a/b/c\",\"/a\"", "\"../..\""],
  ["relative/\"/a\",\"/a/b/c\"", "\"b/c\""],
  ["relative/\"/a/b\",\"/a/b\"", "\"\""],
  ["relative/\"/a//b\",\"/a/b\"", "\"\""],
  ["relative/\"/a/./b\",\"/a/b\"", "\"\""],
  ["relative/\"/a/../b\",\"/b\"", "\"\""],
  ["relative/\"/\",\"/a\"", "\"a\""],
  ["relative/\"/a\",\"/\"", "\"..\""],
  ["join/none", "\".\""],
  ["resolve/none", "\"string\""],
  ["basename/ext", "\"b\""],
  ["basename/ext-whole", "\".txt\""],
  ["format/empty", "\"\""],
  ["format/base-wins", "\"/d/b\""],
];

const results = [];
const attempt = (label, fn) => {
  let out;
  try {
    out = JSON.stringify(fn());
  } catch (error) {
    out = `THROW:${error.code ?? error.constructor.name}`;
  }
  results.push([label, out]);
};

const cases = ["", ".", "..", "/", "//", "///", "a//b", "a/./b", "a/../b", "../a",
  "/../a", "a/b/", "a/b//", "./", "../", "a/..", "a/../..", "/a/../..",
  "\u0000", "a\u0000b", " ", "a ", " a", "a\\b", "C:\\a", "\\\\server\\share"];
for (const c of cases) {
  attempt(`normalize/${JSON.stringify(c)}`, () => path.normalize(c));
  attempt(`dirname/${JSON.stringify(c)}`, () => path.dirname(c));
  attempt(`basename/${JSON.stringify(c)}`, () => path.basename(c));
  attempt(`extname/${JSON.stringify(c)}`, () => path.extname(c));
  attempt(`isAbsolute/${JSON.stringify(c)}`, () => path.isAbsolute(c));
  attempt(`parse/${JSON.stringify(c)}`, () => path.parse(c));
}
for (const [a, b] of [["", ""], ["a", ""], ["", "b"], ["/a", "b"], ["a", "/b"],
  ["a/", "/b"], [".", "."], ["..", ".."], ["/", "/"], ["a", "../b"]]) {
  attempt(`join/${JSON.stringify(a)},${JSON.stringify(b)}`, () => path.join(a, b));
}
// `relative` with a relative operand resolves against `process.cwd()`, which is
// not the same directory for the oracle run and the module run -- those rows
// would differ for a reason that is not a defect. Both operands absolute keeps
// it a pure function of its arguments.
for (const [a, b] of [["/", "/"], ["/a", "/b"], ["/a/b", "/a/c"], ["/a/b/c", "/a"],
  ["/a", "/a/b/c"], ["/a/b", "/a/b"], ["/a//b", "/a/b"], ["/a/./b", "/a/b"],
  ["/a/../b", "/b"], ["/", "/a"], ["/a", "/"]]) {
  attempt(`relative/${JSON.stringify(a)},${JSON.stringify(b)}`, () => path.relative(a, b));
}
attempt("join/none", () => path.join());
attempt("resolve/none", () => typeof path.resolve());
attempt("basename/ext", () => path.basename("a/b.txt", ".txt"));
attempt("basename/ext-whole", () => path.basename("a/.txt", ".txt"));
attempt("format/empty", () => path.format({}));
attempt("format/base-wins", () => path.format({ dir: "/d", base: "b", name: "n", ext: ".e" }));

assert.strictEqual(results.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(results[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(results[i][1], EXPECTED[i][1], results[i][0]);
}
