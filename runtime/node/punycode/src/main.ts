// `node:punycode`, from node v24.20.0 `lib/punycode.js`.
//
// The RFC algorithm is in `codec.ts` because `node:url` uses it internally.
// Only loading this public deprecated module emits DEP0040.

import * as codec from "./codec.ts";
import { emitWarning } from "../../internal/process-warning.ts";

// A compiled program has no CommonJS dependency stack in which this module can
// be hidden. Its public entry is therefore always an application import; the
// stack walk Node uses to suppress dependency warnings has no native analogue
// and no condition to answer here.
emitWarning(
  "The `punycode` module is deprecated. Please use a userland alternative instead.",
  "DeprecationWarning",
  "DEP0040",
);

// Aliases, not wrappers: the public entry point adds no call on top of the RFC
// codec and `ucs2.decode === ucs2decode` remains true.
export const decode = codec.decode;
export const encode = codec.encode;
export const toASCII = codec.toASCII;
export const toUnicode = codec.toUnicode;
export const ucs2decode = codec.ucs2decode;
export const ucs2encode = codec.ucs2encode;
export const version = codec.version;
export const ucs2 = { decode: ucs2decode, encode: ucs2encode };
