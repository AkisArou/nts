import type {Scope} from "../../escope/lib/scope.ts";
import type {TraversalController} from "../../../traversal-types.ts";
type ScopeCallback = (this: TraversalController, node: AstNode, parent: AstNode | null, scope: Scope | null) => unknown;
import type {AstNode, LoggerLike} from "../../../ast.ts";
import type {Constructor, Descriptor} from "../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/withScope.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../webpack.ts";
import {load as load0} from "../../escope/lib/index.ts";
import {load as load1} from "./utils/functionType.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/withScope.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
const exports: { __esModule?: true; "default"?: typeof withScope; } = {};
let module = {exports};
cache = module;


"use strict";


Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = withScope;
var _escope = load0();
var _functionType = load1();
var emptyFn: ScopeCallback = function emptyFn() {}; // eslint-disable-line no-empty-function

/**
 * A helper for traversing with scope info from escope.
 *
 * Usage:
 *
 *     traverser.traverse(ast, withScope(ast, {
 *       enter(node, parent, scope) {
 *         // do something with node and scope
 *       }
 *     }))
 *
 * @param {Object} ast The AST root node also passed to traverser.
 * @param {Object} cfg Object with enter function as expected by traverser.
 * @return {Object} Object with enter function to be passed to traverser.
 */
function withScope(ast: AstNode, _ref: {enter?: ScopeCallback}) {
  var _ref$enter = _ref.enter,
    _enter = _ref$enter === void 0 ? emptyFn : _ref$enter;
  var scopeManager = (0, _escope.analyze)(ast, {
    ecmaVersion: 2022,
    sourceType: 'module'
  });
  var currentScope = scopeManager.acquire(ast);
  return {
    enter: function enter(this: TraversalController, node: AstNode, parent: AstNode | null) {
      if ((0, _functionType.isFunction)(node)) {
        currentScope = scopeManager.acquire(node);
      }
      return _enter.call(this, node, parent, currentScope);
    } // NOTE: leave() is currently not implemented.
    // See escope docs for supporting it if need arises: https://github.com/estools/escope
  };
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
