"use strict";

// Everything `console` writes, captured through a `Writable` rather than a tty.
//
// Node formats through one `util.formatWithOptions` and indents through one
// group-depth counter, so upstream `group` + `log` + `groupEnd` cannot disagree
// with `count` about how a line is prefixed. Here they are separate methods on a
// class that keeps its own depth, and the interesting cases are the ones where
// something goes wrong at a boundary:
//
//   `groupEnd` called more times than `group`, which must not go negative
//   a multi-line string inside a group -- *every* line gets the indent
//   `%s` with more arguments than placeholders, and with fewer
//   a literal `100%` with no format specifier after it
//   `console.table` given a primitive, and given a non-array
//   `countReset` on a counter that was never started, which warns and continues
//   `dir` with an explicit `depth` against `dir` with the default
//
// 22 cases, every expected value read off node v24.20.0. `Console` is
// constructed with an explicit `stdout`/`stderr` so nothing here depends on
// whether the test runner has a terminal.

const assert = require("node:assert");
const { Console } = require("node:console");
const { Writable } = require("node:stream");

const EXPECTED = [
  ["log-string", "a\n"],
  ["log-format", "x-5-{\"a\":1}\n"],
  ["log-percent-literal", "100%\n"],
  ["log-extra-args", "a b c\n"],
  ["log-missing-args", "a %s\n"],
  ["log-object", "{ a: 1, b: [ 2, 3 ] }\n"],
  ["log-no-args", "\n"],
  ["log-undefined", "undefined\n"],
  ["group-indent", "g\n  in\nout\n"],
  ["group-nested", "    deep\nflat\n"],
  ["groupEnd-underflow", "x\n"],
  ["group-multiline", "  a\n  b\n"],
  ["count", "default: 1\ndefault: 2\nk: 1\ndefault: 1\n"],
  ["count-reset-unknown", ""],
  ["dir-depth", "{ a: { b: [Object] } }\n"],
  ["dir-default", "{ a: { b: { c: 1 } } }\n"],
  ["assert-false", "Assertion failed: boom\n"],
  ["assert-true", ""],
  ["table-array", "┌─────────┬───┬───┐\n│ (index) │ a │ b │\n├─────────┼───┼───┤\n│ 0       │ 1 │ 2 │\n│ 1       │ 3 │ 4 │\n└─────────┴───┴───┘\n"],
  ["table-primitive", "┌─────────┬────────┐\n│ (index) │ Values │\n├─────────┼────────┤\n│ 0       │ 1      │\n│ 1       │ 2      │\n└─────────┴────────┘\n"],
  ["table-nonobject", "5\n"],
];

const rows = [];
const capture = (label, fn) => {
  let out = "";
  const sink = new Writable({ write(c, e, cb) { out += c.toString(); cb(); } });
  const c = new Console({ stdout: sink, stderr: sink, colorMode: false });
  try {
    fn(c);
  } catch (e) {
    out += "THROW:" + (e.code || e.constructor.name);
  }
  rows.push([label, out]);
};

capture("log-string", (c) => c.log("a"));
capture("log-format", (c) => c.log("%s-%d-%j", "x", 5, { a: 1 }));
capture("log-percent-literal", (c) => c.log("100%"));
capture("log-extra-args", (c) => c.log("%s", "a", "b", "c"));
capture("log-missing-args", (c) => c.log("%s %s", "a"));
capture("log-object", (c) => c.log({ a: 1, b: [2, 3] }));
capture("log-no-args", (c) => c.log());
capture("log-undefined", (c) => c.log(undefined));
capture("group-indent", (c) => { c.group("g"); c.log("in"); c.groupEnd(); c.log("out"); });
capture("group-nested", (c) => { c.group(); c.group(); c.log("deep"); c.groupEnd(); c.groupEnd(); c.log("flat"); });
capture("groupEnd-underflow", (c) => { c.groupEnd(); c.groupEnd(); c.log("x"); });
capture("group-multiline", (c) => { c.group(); c.log("a\nb"); c.groupEnd(); });
capture("count", (c) => { c.count(); c.count(); c.count("k"); c.countReset(); c.count(); });
capture("count-reset-unknown", (c) => c.countReset("nope"));
capture("dir-depth", (c) => c.dir({ a: { b: { c: { d: 1 } } } }, { depth: 1 }));
capture("dir-default", (c) => c.dir({ a: { b: { c: 1 } } }));
capture("assert-false", (c) => c.assert(false, "boom"));
capture("assert-true", (c) => c.assert(true, "quiet"));
capture("table-array", (c) => c.table([{ a: 1, b: 2 }, { a: 3, b: 4 }]));
capture("table-primitive", (c) => c.table([1, 2]));
capture("table-nonobject", (c) => c.table(5));

assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
for (let i = 0; i < EXPECTED.length; i++) {
  assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
  assert.strictEqual(rows[i][1], EXPECTED[i][1], rows[i][0]);
}
