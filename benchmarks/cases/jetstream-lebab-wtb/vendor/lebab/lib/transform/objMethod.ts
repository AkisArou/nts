import type {AstNode, LoggerLike, Transform} from "../../../../ast.ts";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {classNode, classExpression, classText, programNode} from "./runtime-transforms.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/objMethod.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../f-matches/index.ts";
import {load as load1} from "../traverser.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/objMethod.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _fMatches = load0();
var _traverser = _interopRequireDefault(load1());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var matchTransformableProperty = (0, _fMatches.matches)({
  type: 'Property',
  key: {
    type: 'Identifier'
  },
  value: {
    type: 'FunctionExpression',
    id: (0, _fMatches.extractAny)('functionName')
  },
  method: false,
  computed: false,
  shorthand: false
});
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      var match = matchTransformableProperty(node);
      if (match) {
        // Do not transform functions with name,
        // as the name might be recursively referenced from inside.
        if (match.functionName) {
          logger.warn(node, 'Unable to transform named function', 'obj-method');
          return;
        }
        record(node).method = true;
      }
    }
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
