import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import {classExpression, searchArgument} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/includes/index.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";
import {load as load1} from "./matchesIndexOf.ts";
import {load as load2} from "./comparison.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/includes/index.js");
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
var _traverser = _interopRequireDefault(load0());
var _matchesIndexOf = _interopRequireDefault(load1());
var _comparison = load2();
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode) {
      var matches = (0, _matchesIndexOf["default"])(node);
      if (matches && (0, _comparison.isIncludesComparison)(matches)) {
        return createIncludes(matches);
      }
      if (matches && (0, _comparison.isNotIncludesComparison)(matches)) {
        return createNot(createIncludes(matches));
      }
    }
  });
}
function createNot(argument: K.ExpressionKind): K.UnaryExpressionKind {
  return {
    type: 'UnaryExpression',
    operator: '!',
    prefix: true,
    argument: argument
  };
}
function createIncludes(_ref: Record<string, unknown>): K.CallExpressionKind {
  var object = classExpression(_ref.object),
    searchElement = searchArgument(_ref.searchElement);
  return {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: object,
      property: {
        type: 'Identifier',
        name: 'includes'
      }
    },
    arguments: [searchElement]
  };
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
