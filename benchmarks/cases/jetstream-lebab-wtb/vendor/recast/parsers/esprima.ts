import type {Comment} from "../../esprima/dist/modules/comment-handler.ts";
// Exact module body from JetStream 3.0 ./node_modules/recast/parsers/esprima.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord} from "../../../webpack.ts";
import {load as load0} from "../lib/util.ts";
import {load as load1} from "../../esprima/dist/esprima.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for recast/parsers/esprima.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return exportsReady(value, ["__esModule","parse"]);
}
function initialize() {
const exports: { __esModule?: true; "parse"?: typeof parse; } = {};
let module = {exports};
cache = module;


"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.parse = void 0;
// This module is suitable for passing as options.parser when calling
// recast.parse to process ECMAScript code with Esprima:
//
//   const ast = recast.parse(source, {
//     parser: require("recast/parsers/esprima")
//   });
//
var util_1 = load0();
function parse(source: string, options?: unknown) {
    var comments: Comment[] = [];
    var ast = (load1().parse)(source, {
        loc: true,
        locations: true,
        comment: true,
        onComment: comments,
        range: (0, util_1.getOption)(options, "range", false),
        tolerant: (0, util_1.getOption)(options, "tolerant", true),
        tokens: true,
        jsx: (0, util_1.getOption)(options, "jsx", false),
        sourceType: (0, util_1.getOption)(options, "sourceType", "module"),
    });
    if (!Array.isArray(ast.comments)) {
        ast.comments = comments;
    }
    return ast;
}
exports.parse = parse;


/***/ 
if (!exportsReady(exports, ["__esModule","parse"])) throw new TypeError("Incomplete original module exports");
return exports;
}
