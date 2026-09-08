"use strict";

// Where `readline` decides a line ended.
//
// Node splits in one place with one buffered remainder, so upstream a CRLF that
// arrives in two chunks and one that arrives in one cannot take different paths.
// Here the buffering is TypeScript, and every one of these is a chance for the
// remainder to be dropped, doubled or mis-joined:
//
//   a CRLF split across two chunks, and across *three*
//   a lone CR at end of input, with nothing after it
//   CR-only line endings, which are still line endings
//   a BOM, which is data and must survive into the first line
//   a NUL inside a line, which is also data
//   no trailing newline at all -- the last partial line is still emitted
//   an entirely empty input, which emits nothing rather than one empty line
//
// 15 cases, every expected value read off node v24.20.0. The interface is built
// with `terminal: false` so nothing depends on whether the runner has a tty.
//
// Results are sorted before comparing: the cases complete on their own
// schedules, and the order they finish in is not what this file is about.

const assert = require("node:assert");
const readline = require("node:readline");
const { Readable } = require("node:stream");

const EXPECTED = [
  ["bom", ["﻿a"]],
  ["cr-only", ["a","b"]],
  ["cr-then-eof", ["a","b"]],
  ["crlf", ["a","b"]],
  ["crlf-crlf", ["",""]],
  ["crlf-split-3", ["a","b"]],
  ["empty-input", []],
  ["empty-lines", ["","",""]],
  ["lf", ["a","b"]],
  ["lone-cr-at-end", ["a"]],
  ["long-then-short", ["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","y"]],
  ["mixed", ["a","b","c"]],
  ["no-trailing-lf", ["a","b"]],
  ["nul", ["a\u0000b"]],
  ["split-crlf-across-chunks", ["a","b"]],
  ["split-lf-across-chunks", ["a","b"]],
];

const rows = [];
const pending = [];
const feed = (label, chunks) => {
  pending.push(new Promise((resolve) => {
    const input = new Readable({ read() {} });
    const rl = readline.createInterface({ input, terminal: false });
    const lines = [];
    rl.on("line", (l) => lines.push(l));
    rl.on("close", () => {
      rows.push([label, JSON.stringify(lines)]);
      resolve();
    });
    for (const c of chunks) input.push(c);
    input.push(null);
  }));
};

const LF = String.fromCharCode(10), CR = String.fromCharCode(13);
const BOM = String.fromCharCode(0xfeff), NUL = String.fromCharCode(0);
feed("lf", ["a" + LF + "b" + LF]);
feed("no-trailing-lf", ["a" + LF + "b"]);
feed("crlf", ["a" + CR + LF + "b" + CR + LF]);
feed("cr-only", ["a" + CR + "b" + CR]);
feed("mixed", ["a" + CR + LF + "b" + LF + "c" + CR]);
feed("empty-lines", [LF + LF + LF]);
feed("empty-input", [""]);
feed("split-crlf-across-chunks", ["a" + CR, LF + "b" + LF]);
feed("split-lf-across-chunks", ["a", LF, "b" + LF]);
feed("lone-cr-at-end", ["a" + CR]);
feed("bom", [BOM + "a" + LF]);
feed("nul", ["a" + NUL + "b" + LF]);
feed("long-then-short", ["x".repeat(100) + LF + "y" + LF]);
feed("crlf-crlf", [CR + LF + CR + LF]);
feed("cr-then-eof", ["a" + CR + "b"]);
feed("crlf-split-3", ["a", CR, LF, "b"]);

Promise.all(pending).then(() => {
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  assert.strictEqual(rows.length, EXPECTED.length, "every case was reached");
  for (let i = 0; i < EXPECTED.length; i++) {
    assert.strictEqual(rows[i][0], EXPECTED[i][0], `case ${i} label`);
    assert.strictEqual(rows[i][1], JSON.stringify(EXPECTED[i][1]), rows[i][0]);
  }
});
