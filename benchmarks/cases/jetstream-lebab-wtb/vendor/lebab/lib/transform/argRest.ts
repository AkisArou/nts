import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import type {Scope} from "../../../escope/lib/scope.ts";
import type {Variable} from "../../../escope/lib/variable.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/argRest.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../withScope.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/argRest.js");
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
var _withScope = _interopRequireDefault(load2());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode) {
  (_traverser["default"]!).replace(ast, (0, _withScope["default"])(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null, scope: Scope | null) {
      if (isES5Function(node) && node.params.length === 0) {
        var argumentsVar = (0, _fp.find)(function (v: Variable) {
          return v.name === 'arguments';
        }, scope!.variables);
        // Look through all the places where arguments is used:
        // Make sure none of these has access to some already existing `args` variable
        if (argumentsVar && argumentsVar.references.length > 0 && !argumentsVar.references.some(function (ref) {
          return hasArgs(ref.from);
        })) {
          // Change all arguments --> args
          argumentsVar.references.forEach(function (ref: { identifier: { name: string; }; }) {
            ref.identifier.name = 'args';
          });
          // Change function() --> function(...args)
          node.params = [createRestElement()];
        }
      }
    }
  }));
}
function isES5Function(node: AstNode): node is N.FunctionDeclaration | N.FunctionExpression {
  return node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression';
}
function hasArgs(scope: Scope | null): boolean {
  if (!scope) {
    return false;
  }
  if (scope.variables.some(function (v: { name: string; }) {
    return v.name === 'args';
  })) {
    return true;
  }
  return hasArgs(scope.upper);
}
function createRestElement(): N.RestElement {
  return {
    type: 'RestElement',
    argument: {
      type: 'Identifier',
      name: 'args'
    }
  };
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
