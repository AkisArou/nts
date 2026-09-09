"use strict";

// Every encoding spelling node accepts, against every `fs` call that takes one.
//
// Node normalises encodings in one place and hands the same canonical value to
// every consumer, so a test that an alias works in one call is a test that it
// works in all of them. Here each call reaches its own path -- `readFile`
// decodes through `requireTextEncoding`, `readdir` and `readlink` through
// `normalizeFileResultEncoding`, `realpath` through `encodeFileName` -- and
// they can disagree with each other and with node independently.
//
// Twenty-four spellings across four calls. Every expected value below was read
// off node v24.20.0 rather than written from the documentation, which matters
// for the one row that is genuinely surprising:
//
//     readFile/buffer  ->  THROW:ERR_UNKNOWN_ENCODING
//     readFile/BUFFER  ->  THROW:ERR_INVALID_ARG_VALUE
//
// `"buffer"` is a valid option value for `readdir`, `readlink` and `realpath`,
// which all answer Buffers for it, so node's option validation lets it through
// and `readFile` fails later at `Buffer.prototype.toString("buffer")` with a
// *different error code*. Exactly the lowercase spelling: the other casings fail
// the earlier validation and get the generic one. This implementation reported
// `ERR_INVALID_ARG_VALUE` for both until this file was written, and no test in
// node's 260 `fs` files could have seen it.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EXPECTED = [
  "readFile/utf8=string",
  "readdir/utf8=[string]",
  "readlink/utf8=string",
  "realpath/utf8=string",
  "readFile/utf-8=string",
  "readdir/utf-8=[string]",
  "readlink/utf-8=string",
  "realpath/utf-8=string",
  "readFile/UTF8=string",
  "readdir/UTF8=[string]",
  "readlink/UTF8=string",
  "realpath/UTF8=string",
  "readFile/UTF-8=string",
  "readdir/UTF-8=[string]",
  "readlink/UTF-8=string",
  "realpath/UTF-8=string",
  "readFile/Utf8=string",
  "readdir/Utf8=[string]",
  "readlink/Utf8=string",
  "realpath/Utf8=string",
  "readFile/latin1=string",
  "readdir/latin1=[string]",
  "readlink/latin1=string",
  "realpath/latin1=string",
  "readFile/LATIN1=string",
  "readdir/LATIN1=[string]",
  "readlink/LATIN1=string",
  "realpath/LATIN1=string",
  "readFile/binary=string",
  "readdir/binary=[string]",
  "readlink/binary=string",
  "realpath/binary=string",
  "readFile/BINARY=string",
  "readdir/BINARY=[string]",
  "readlink/BINARY=string",
  "realpath/BINARY=string",
  "readFile/ascii=string",
  "readdir/ascii=[string]",
  "readlink/ascii=string",
  "realpath/ascii=string",
  "readFile/ASCII=string",
  "readdir/ASCII=[string]",
  "readlink/ASCII=string",
  "realpath/ASCII=string",
  "readFile/ucs2=string",
  "readdir/ucs2=[string]",
  "readlink/ucs2=string",
  "realpath/ucs2=string",
  "readFile/ucs-2=string",
  "readdir/ucs-2=[string]",
  "readlink/ucs-2=string",
  "realpath/ucs-2=string",
  "readFile/UCS2=string",
  "readdir/UCS2=[string]",
  "readlink/UCS2=string",
  "realpath/UCS2=string",
  "readFile/utf16le=string",
  "readdir/utf16le=[string]",
  "readlink/utf16le=string",
  "realpath/utf16le=string",
  "readFile/utf-16le=string",
  "readdir/utf-16le=[string]",
  "readlink/utf-16le=string",
  "realpath/utf-16le=string",
  "readFile/UTF16LE=string",
  "readdir/UTF16LE=[string]",
  "readlink/UTF16LE=string",
  "realpath/UTF16LE=string",
  "readFile/base64=string",
  "readdir/base64=[string]",
  "readlink/base64=string",
  "realpath/base64=string",
  "readFile/BASE64=string",
  "readdir/BASE64=[string]",
  "readlink/BASE64=string",
  "realpath/BASE64=string",
  "readFile/base64url=string",
  "readdir/base64url=[string]",
  "readlink/base64url=string",
  "realpath/base64url=string",
  "readFile/hex=string",
  "readdir/hex=[string]",
  "readlink/hex=string",
  "realpath/hex=string",
  "readFile/HEX=string",
  "readdir/HEX=[string]",
  "readlink/HEX=string",
  "realpath/HEX=string",
  "readFile/buffer=THROW:ERR_UNKNOWN_ENCODING",
  "readdir/buffer=[object]",
  "readlink/buffer=Buffer",
  "realpath/buffer=Buffer",
  "readFile/BUFFER=THROW:ERR_INVALID_ARG_VALUE",
  "readdir/BUFFER=THROW:ERR_INVALID_ARG_VALUE",
  "readlink/BUFFER=THROW:ERR_INVALID_ARG_VALUE",
  "realpath/BUFFER=THROW:ERR_INVALID_ARG_VALUE",
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nts-encoding-"));
const f = path.join(dir, "f");

try {
  fs.writeFileSync(f, "hello");
  fs.symlinkSync("f", path.join(dir, "l"));
  const encodings = [
    "utf8", "utf-8", "UTF8", "UTF-8", "Utf8",
    "latin1", "LATIN1", "binary", "BINARY",
    "ascii", "ASCII",
    "ucs2", "ucs-2", "UCS2", "utf16le", "utf-16le", "UTF16LE",
    "base64", "BASE64", "base64url",
    "hex", "HEX",
    "buffer", "BUFFER",
  ];
  const rows = [];
  for (const encoding of encodings) {
    for (const [label, call] of [
      ["readFile", () => fs.readFileSync(f, encoding)],
      ["readdir", () => fs.readdirSync(dir, encoding)],
      ["readlink", () => fs.readlinkSync(path.join(dir, "l"), encoding)],
      ["realpath", () => fs.realpathSync(f, encoding)],
    ]) {
      let outcome;
      try {
        const value = call();
        outcome = Buffer.isBuffer(value)
          ? "Buffer"
          : Array.isArray(value)
          ? `[${typeof value[0]}]`
          : typeof value;
      } catch (error) {
        outcome = `THROW:${error.code ?? error.constructor.name}`;
      }
      rows.push(`${label}/${encoding}=${outcome}`);
    }
  }
  assert.deepStrictEqual(rows, EXPECTED, "every encoding spelling answers what node answers");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
