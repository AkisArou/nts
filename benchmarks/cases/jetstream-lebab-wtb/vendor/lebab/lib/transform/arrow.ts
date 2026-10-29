import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import {classNode} from "./runtime-transforms.ts";
import {matchedFunction} from "./runtime-remaining.ts";
type OriginalNode = AstNode & {original?: AstNode | null};
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/arrow.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../syntax/ArrowFunctionExpression.ts";
import {load as load3} from "../../../f-matches/index.ts";
import {load as load4} from "../utils/copyComments.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/arrow.js");
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
var _ArrowFunctionExpression = _interopRequireDefault(load2());
var _fMatches = load3();
var _copyComments = _interopRequireDefault(load4());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      if (isFunctionConvertableToArrow(node, parent)) {
        if (hasArguments(node.body)) {
          logger.warn(node, 'Can not use arguments in arrow function', 'arrow');
          return;
        }
        return functionToArrow(node, parent);
      }
      var _matchBoundFunction = matchBoundFunction(node),
        func = readProperty(_matchBoundFunction, "func");
      if (func) {
        return functionToArrow(matchedFunction(func), parent);
      }
    }
  });
}
function isFunctionConvertableToArrow(node: AstNode, parent: AstNode | null): node is N.FunctionExpression {
  return node.type === 'FunctionExpression' && parent!.type !== 'Property' && parent!.type !== 'MethodDefinition' && !node.id && !node.generator && !hasThis(node.body);
}

// Matches: function(){}.bind(this)
function matchBoundFunction(node: AstNode) {
  return (0, _fMatches.matches)({
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      computed: false,
      object: (0, _fMatches.extract)('func', {
        type: 'FunctionExpression',
        id: null,
        // eslint-disable-line no-null/no-null
        body: function body(_body: unknown) {
          return !hasArguments(classNode(_body));
        },
        generator: false
      }),
      property: {
        type: 'Identifier',
        name: 'bind'
      }
    },
    arguments: (0, _fMatches.matchesLength)([{
      type: 'ThisExpression'
    }])
  }, node);
}
function hasThis(ast: AstNode) {
  return hasInFunctionBody(ast, {
    type: 'ThisExpression'
  });
}
function hasArguments(ast: AstNode) {
  return hasInFunctionBody(ast, {
    type: 'Identifier',
    name: 'arguments'
  });
}

// Returns true when pattern matches any node in given function body,
// excluding any nested functions
function hasInFunctionBody(ast: AstNode, pattern: { type: string; name?: string; }) {
  return (_traverser["default"]!).find(ast, (0, _fp.matches)(pattern), {
    skipTypes: ['FunctionExpression', 'FunctionDeclaration']
  });
}
function functionToArrow(func: N.FunctionExpression, parent: OriginalNode | null) {
  var arrow = new (_ArrowFunctionExpression["default"]!)({
    body: func.body,
    params: func.params,
    defaults: func.defaults,
    rest: func.rest,
    async: func.async
  });
  (0, _copyComments["default"])({
    from: func,
    to: arrow
  });

  // Get rid of extra parentheses around IIFE
  // by forcing Recast to reformat the CallExpression
  if (isIIFE(func, parent)) {
    parent!.original = null; // eslint-disable-line no-null/no-null
  }
  return arrow;
}

// Is it immediately invoked function expression?
function isIIFE(func: N.FunctionExpression, parent: AstNode | null) {
  return parent!.type === 'CallExpression' && parent!.callee === func;
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
