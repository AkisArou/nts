import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {classExpression} from "./runtime-transforms.ts";
import {matchedMember} from "./runtime-remaining.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/argSpread.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../../../f-matches/index.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/argSpread.js");
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
var _fp = load0();
var _traverser = _interopRequireDefault(load1());
var _fMatches = load2();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      var _matchFunctionApplyCa = matchFunctionApplyCall(node),
        func = readProperty(_matchFunctionApplyCa, "func"),
        array = readProperty(_matchFunctionApplyCa, "array");
      if (func) {
        return createCallWithSpread(classExpression(func), classExpression(array));
      }
      var _matchObjectApplyCall = matchObjectApplyCall(node),
        memberExpr = readProperty(_matchObjectApplyCall, "memberExpr"),
        thisParam = readProperty(_matchObjectApplyCall, "thisParam"),
        arrayParam = readProperty(_matchObjectApplyCall, "arrayParam");
      if (memberExpr && (0, _fp.isEqual)(omitLoc(matchedMember(memberExpr).object), omitLoc(thisParam))) {
        return createCallWithSpread(matchedMember(memberExpr), classExpression(arrayParam));
      }
    }
  });
}
function createCallWithSpread(func: N.CallExpression["callee"], array: K.ExpressionKind): N.CallExpression {
  return {
    type: 'CallExpression',
    callee: func,
    arguments: [{
      type: 'SpreadElement',
      argument: array
    }]
  };
}

// Recursively strips `loc`, `start` and `end` fields from given object and its nested objects,
// removing the location information that we don't care about when comparing
// AST nodes.
function omitLoc(obj: unknown): unknown {
  if ((0, _fp.isArray)(obj)) {
    return obj.map(omitLoc);
  } else if ((0, _fp.isObjectLike)(obj)) {
    return (0, _fp.flow)((0, _fp.omit)(['loc', 'start', 'end']), (0, _fp.mapValues)(omitLoc))(obj);
  } else {
    return obj;
  }
}
var isUndefined = (0, _fMatches.matches)({
  type: 'Identifier',
  name: 'undefined'
});
var isNull = (0, _fMatches.matches)({
  type: 'Literal',
  value: null,
  // eslint-disable-line no-null/no-null
  raw: 'null'
});
function matchFunctionApplyCall(node: AstNode) {
  return (0, _fMatches.matches)({
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: (0, _fMatches.extract)('func', {
        type: 'Identifier'
      }),
      property: {
        type: 'Identifier',
        name: 'apply'
      }
    },
    arguments: [function (arg: unknown) {
      return isUndefined(arg) || isNull(arg);
    }, (0, _fMatches.extractAny)('array')]
  }, node);
}
function matchObjectApplyCall(node: AstNode) {
  return (0, _fMatches.matches)({
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: (0, _fMatches.extract)('memberExpr', {
        type: 'MemberExpression'
      }),
      property: {
        type: 'Identifier',
        name: 'apply'
      }
    },
    arguments: [(0, _fMatches.extractAny)('thisParam'), (0, _fMatches.extractAny)('arrayParam')]
  }, node);
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
