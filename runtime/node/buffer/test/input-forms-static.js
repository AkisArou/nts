"use strict";

// Every input form `Buffer.from` accepts, and every needle type `indexOf`,
// `compare` and `equals` accept.
//
// Node coerces all of these in one place, so upstream a test that an
// `ArrayBuffer` works is a test that a `DataView` works. Here each form reaches
// its own branch. Node's own coverage of the unusual ones is thin — of 69
// `test-buffer-*.js` files, **3** mention `Symbol.toPrimitive` or `valueOf`, **2**
// construct a `DataView`, and **3** touch `indexOf` at all.
//
// Thirty of thirty-two match node exactly, including `Buffer.from` on an
// `Int8Array` of negative values, a `Uint16Array` (which reinterprets rather
// than converts), an `ArrayBuffer` with offset and length, a plain
// `{length, 0, 1}` object, and `indexOf` with a `Uint8Array` needle.
//
// **The two that differ are refusals this compiler makes on purpose.**
// `Buffer.from({ valueOf })` and `Buffer.from({ [Symbol.toPrimitive] })` coerce
// on node and throw `ERR_INVALID_ARG_TYPE` here, because `ToPrimitive` dispatch
// and `Symbol.toPrimitive` are both listed in `docs/conformance/typescript.md`
// §13, *What this compiler is not* — "one decision made once", not a backlog
// item.
//
// That is the reason these two rows are **asserted** rather than omitted, and it
// is the opposite of the rule the `fs` byte-path test records. A test may not
// assert what the implementation happens to do; it may assert a **declared
// decision**, and the difference is whether the divergence is written down
// somewhere as intended. If §13 ever admits `ToPrimitive`, these two rows fail
// and say so.

const assert = require("node:assert");

const EXPECTED = {
  "from/array": "Buffer[1,2,3]",
  "from/array-oob": "Buffer[0,255,1,0]",
  "from/buffer": "Buffer[1,2,3,4]",
  "from/uint8": "Buffer[1,2]",
  "from/int8": "Buffer[255,2]",
  "from/uint16": "Buffer[2]",
  "from/float64": "Buffer[1]",
  "from/arraybuffer": "Buffer[9,8,7]",
  "from/arraybuffer-offset": "Buffer[8,7]",
  "from/arraybuffer-offset-len": "Buffer[8]",
  "from/dataview": "Buffer[]",
  "from/string": "Buffer[97,98]",
  "from/string-hex": "Buffer[1,2]",
  "from/string-base64": "Buffer[1,2]",
  "from/valueOf": "THROW:ERR_INVALID_ARG_TYPE",  // §13, see the header — node gives Buffer[122,122]
  "from/toPrimitive": "THROW:ERR_INVALID_ARG_TYPE",  // §13, see the header — node gives Buffer[121,121]
  "from/length-object": "Buffer[7,8]",
  "from/null": "THROW:ERR_INVALID_ARG_TYPE",
  "from/number": "THROW:ERR_INVALID_ARG_TYPE",
  "from/empty-array": "Buffer[]",
  "indexOf/string": "n:6",
  "indexOf/buffer": "n:6",
  "indexOf/uint8": "n:6",
  "indexOf/number": "n:6",
  "indexOf/absent": "n:-1",
  "indexOf/empty": "n:0",
  "indexOf/negative-start": "n:7",
  "includes/string": "b:true",
  "lastIndexOf/string": "n:7",
  "compare/self": "n:0",
  "compare/uint8": "n:0",
  "compare/ranges": "n:0",
  "equals/uint8": "b:true",
};

const describe = (v) => {
  if (Buffer.isBuffer(v)) return `Buffer[${[...v].join(",")}]`;
  if (typeof v === "number") return `n:${v}`;
  if (typeof v === "boolean") return `b:${v}`;
  return `${typeof v}:${JSON.stringify(v)}`;
};

const results = {};
const attempt = (label, fn) => {
  try { results[label] = describe(fn()); }
  catch (error) { results[label] = `THROW:${error.code ?? error.constructor.name}`; }
};

const src = Buffer.from([1, 2, 3, 4]);
attempt("from/array", () => Buffer.from([1, 2, 3]));
attempt("from/array-oob", () => Buffer.from([256, -1, 1.5, NaN]));
attempt("from/buffer", () => Buffer.from(src));
attempt("from/uint8", () => Buffer.from(new Uint8Array([1, 2])));
attempt("from/int8", () => Buffer.from(new Int8Array([-1, 2])));
attempt("from/uint16", () => Buffer.from(new Uint16Array([258])));
attempt("from/float64", () => Buffer.from(new Float64Array([1.5])));
attempt("from/arraybuffer", () => Buffer.from(new Uint8Array([9, 8, 7]).buffer));
attempt("from/arraybuffer-offset", () => Buffer.from(new Uint8Array([9, 8, 7]).buffer, 1));
attempt("from/arraybuffer-offset-len", () => Buffer.from(new Uint8Array([9, 8, 7]).buffer, 1, 1));
attempt("from/dataview", () => Buffer.from(new DataView(new Uint8Array([5, 6]).buffer)));
attempt("from/string", () => Buffer.from("ab"));
attempt("from/string-hex", () => Buffer.from("0102", "hex"));
attempt("from/string-base64", () => Buffer.from("AQI=", "base64"));
attempt("from/valueOf", () => Buffer.from({ valueOf: () => "zz" }));
attempt("from/toPrimitive", () => Buffer.from({ [Symbol.toPrimitive]: () => "yy" }));
attempt("from/length-object", () => Buffer.from({ length: 2, 0: 7, 1: 8 }));
attempt("from/null", () => Buffer.from(null));
attempt("from/number", () => Buffer.from(3));
attempt("from/empty-array", () => Buffer.from([]));

const hay = Buffer.from("hello world");
attempt("indexOf/string", () => hay.indexOf("world"));
attempt("indexOf/buffer", () => hay.indexOf(Buffer.from("world")));
attempt("indexOf/uint8", () => hay.indexOf(new Uint8Array([0x77, 0x6f])));
attempt("indexOf/number", () => hay.indexOf(0x77));
attempt("indexOf/absent", () => hay.indexOf("zzz"));
attempt("indexOf/empty", () => hay.indexOf(""));
attempt("indexOf/negative-start", () => hay.indexOf("o", -5));
attempt("includes/string", () => hay.includes("lo w"));
attempt("lastIndexOf/string", () => hay.lastIndexOf("o"));
attempt("compare/self", () => src.compare(src));
attempt("compare/uint8", () => src.compare(new Uint8Array([1, 2, 3, 4])));
attempt("compare/ranges", () => src.compare(Buffer.from([2, 3]), 0, 2, 1, 3));
attempt("equals/uint8", () => src.equals(new Uint8Array([1, 2, 3, 4])));

assert.deepStrictEqual(results, EXPECTED);
