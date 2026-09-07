// `buffer.Buffer` is the global `Buffer`, and `buffer.Blob` is the global
// `Blob`, neither of which any upstream test asserts.
//
// Node guarantees all four of these. Nothing in node's pinned `parallel/` suite
// checks any of them, for the same reason it does not check that a `Buffer` is
// a `Uint8Array`: on node they cannot be otherwise. See
// `uint8array-identity-static.js` beside this file for the longer argument.
//
// `Blob` and `File` are web-platform's, reused here rather than reimplemented,
// so these assertions are the record of a cross-lane agreement about where a
// class lives. A rename or a re-wrap on either side keeps every reference
// intact and silently breaks `===`, which is why a dead-export gate cannot see
// it and a test has to.
"use strict";

require("../common");

const assert = require("assert");
const buffer = require("buffer");

for (const name of ["Buffer", "Blob", "File", "atob", "btoa"]) {
  assert.strictEqual(
    buffer[name],
    globalThis[name],
    `buffer.${name} is not the global ${name}`,
  );
}

// The identity is for interchange, so check that it buys interchange.
{
  const made = buffer.Buffer.from("hi");
  assert.ok(made instanceof globalThis.Buffer, "a module Buffer is not a global Buffer");
  assert.ok(globalThis.Buffer.isBuffer(made), "the global Buffer does not recognise it");

  const blob = new buffer.Blob(["hi"]);
  assert.ok(blob instanceof globalThis.Blob, "a module Blob is not a global Blob");
  assert.strictEqual(blob.size, 2);
}
