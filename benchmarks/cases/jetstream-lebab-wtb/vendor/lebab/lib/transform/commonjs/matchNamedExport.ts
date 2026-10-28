import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/commonjs/matchNamedExport.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../../../f-matches/index.ts";
import {load as load1} from "./isExports.ts";
import {load as load2} from "./isModuleExports.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/commonjs/matchNamedExport.js");
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
exports["default"] = void 0;
var _fMatches = load0();
var _isExports = _interopRequireDefault(load1());
var _isModuleExports = _interopRequireDefault(load2());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
/**
 * Matches: exports.<id> = <value>
 * Matches: module.exports.<id> = <value>
 *
 * When match found, returns object with:
 *
 * - id
 * - value
 *
 * @param  {[type]} node [description]
 * @return {[type]}      [description]
 */
var _default = (0, _fMatches.matches)({
  type: 'ExpressionStatement',
  expression: {
    type: 'AssignmentExpression',
    operator: '=',
    left: {
      type: 'MemberExpression',
      computed: false,
      object: function object(ast: AstNode) {
        return (0, _isExports["default"])(ast) || (0, _isModuleExports["default"])(ast);
      },
      property: (0, _fMatches.extract)('id', {
        type: 'Identifier'
      })
    },
    right: (0, _fMatches.extractAny)('value')
  }
});
exports["default"] = _default;

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
