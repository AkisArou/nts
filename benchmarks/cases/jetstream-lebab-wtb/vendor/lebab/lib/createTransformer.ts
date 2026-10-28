import type {AstNode, LoggerLike, Transform} from "../../../ast.ts";
import type * as K from "../../../types/ast-types/gen/kinds.js";
import {classNode, classExpression, classText, programNode} from "./transform/runtime-transforms.ts";
import type {Constructor, Descriptor} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/createTransformer.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../webpack.ts";
import {load as load0} from "./Transformer.ts";
import {load as load1} from "./transform/class/index.ts";
import {load as load2} from "./transform/template.ts";
import {load as load3} from "./transform/arrow.ts";
import {load as load4} from "./transform/arrowReturn.ts";
import {load as load5} from "./transform/let.ts";
import {load as load6} from "./transform/defaultParam/index.ts";
import {load as load7} from "./transform/destructParam.ts";
import {load as load8} from "./transform/argSpread.ts";
import {load as load9} from "./transform/argRest.ts";
import {load as load10} from "./transform/objMethod.ts";
import {load as load11} from "./transform/objShorthand.ts";
import {load as load12} from "./transform/noStrict.ts";
import {load as load13} from "./transform/commonjs/index.ts";
import {load as load14} from "./transform/exponent.ts";
import {load as load15} from "./transform/multiVar.ts";
import {load as load16} from "./transform/forOf.ts";
import {load as load17} from "./transform/forEach/index.ts";
import {load as load18} from "./transform/includes/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/createTransformer.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof createTransformer; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = createTransformer;
var _Transformer = _interopRequireDefault(load0());
var _class = _interopRequireDefault(load1());
var _template = _interopRequireDefault(load2());
var _arrow = _interopRequireDefault(load3());
var _arrowReturn = _interopRequireDefault(load4());
var _let = _interopRequireDefault(load5());
var _defaultParam = _interopRequireDefault(load6());
var _destructParam = _interopRequireDefault(load7());
var _argSpread = _interopRequireDefault(load8());
var _argRest = _interopRequireDefault(load9());
var _objMethod = _interopRequireDefault(load10());
var _objShorthand = _interopRequireDefault(load11());
var _noStrict = _interopRequireDefault(load12());
var _commonjs = _interopRequireDefault(load13());
var _exponent = _interopRequireDefault(load14());
var _multiVar = _interopRequireDefault(load15());
var _forOf = _interopRequireDefault(load16());
var _forEach = _interopRequireDefault(load17());
var _includes = _interopRequireDefault(load18());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var transformsMap: Record<string, Transform> = {
  'class': (_class["default"]!),
  'template': (_template["default"]!),
  'arrow': (_arrow["default"]!),
  'arrow-return': (_arrowReturn["default"]!),
  'let': (_let["default"]!),
  'default-param': (_defaultParam["default"]!),
  'destruct-param': (_destructParam["default"]!),
  'arg-spread': (_argSpread["default"]!),
  'arg-rest': (_argRest["default"]!),
  'obj-method': (_objMethod["default"]!),
  'obj-shorthand': (_objShorthand["default"]!),
  'no-strict': (_noStrict["default"]!),
  'commonjs': (_commonjs["default"]!),
  'exponent': (_exponent["default"]!),
  'multi-var': (_multiVar["default"]!),
  'for-of': (_forOf["default"]!),
  'for-each': (_forEach["default"]!),
  'includes': (_includes["default"]!)
};

/**
 * Factory for creating a Transformer
 * by just specifying the names of the transforms.
 * @param  {String[]} transformNames
 * @return {Transformer}
 */
function createTransformer(transformNames: string[]) {
  validate(transformNames);
  return new (_Transformer["default"]!)(transformNames.map(function (name: string) {
    return transformsMap[name];
  }));
}
function validate(transformNames: string[]) {
  transformNames.forEach(function (name: string) {
    if (!transformsMap[name]) {
      throw "Unknown transform \"".concat(name, "\".");
    }
  });
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
