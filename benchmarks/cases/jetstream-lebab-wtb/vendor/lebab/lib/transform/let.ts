import type {namedTypes as N} from "../../../../types/ast-types/gen/namedTypes.js";
import {scopeVariable, type ScopeEntry, type ScopeLike, type ScopeManagerLike, type VariableLike, type VariableGroupLike} from "../../../../ast.ts";
import {declaratorView} from "../../../../scope-layouts.ts";
import type {HoistConfig} from "../scope/FunctionHoister.ts";
import {variableDeclarator} from "./runtime-remaining.ts";
import type {WildcardCache, WildcardCacheFactory} from "../../../../emitted-helper-types.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/let.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {runtimeArrayLikeOrIterable, runtimeArrayLike, runtimeProperty, runtimeCallable, exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../../../lodash/fp.ts";
import {load as load1} from "../traverser.ts";
import {load as load2} from "../utils/functionType.ts";
import {load as load3} from "../utils/variableType.ts";
import {load as load4} from "../utils/destructuring.ts";
import {load as load5} from "../utils/multiReplaceStatement.ts";
import {load as load6} from "../scope/ScopeManager.ts";
import {load as load7} from "../scope/VariableMarker.ts";
import {load as load8} from "../scope/FunctionHoister.ts";
import {load as load9} from "../syntax/VariableDeclaration.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/let.js");
  return value;
 }
 return initialize();
}
function isExport(value: Partial<ReturnType<typeof initialize>>): value is ReturnType<typeof initialize> {
 return isRecord(value) && value.__esModule === true && value["default"] !== undefined;
}
function initialize() {
let _getRequireWildcardCache: WildcardCacheFactory = function(nodeInterop?: boolean): WildcardCache | null { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap<object, Record<string, unknown>>(); var cacheNodeInterop = new WeakMap<object, Record<string, unknown>>(); return (_getRequireWildcardCache = function _getRequireWildcardCache(nodeInterop?: boolean) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); };
const exports: { __esModule?: true; "default"?: typeof _default; } = {};
let module = {exports};
cache = module;


"use strict";


var _typeof = function(obj: unknown): string { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (obj: unknown) { return typeof obj; } : function (obj: unknown) { return obj && "function" == typeof Symbol && readProperty(obj, "constructor") === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }, _typeof(obj); };
Object.defineProperty(exports, "__esModule", ({
  value: true
}));
exports["default"] = _default;
var _fp = load0();
var _traverser = _interopRequireDefault(load1());
var functionType = _interopRequireWildcard(load2());
var variableType = _interopRequireWildcard(load3());
var destructuring = _interopRequireWildcard(load4());
var _multiReplaceStatement = _interopRequireDefault(load5());
var _ScopeManager = _interopRequireDefault(load6());
var _VariableMarker = _interopRequireDefault(load7());
var _FunctionHoister = _interopRequireDefault(load8());
var _VariableDeclaration = _interopRequireDefault(load9());

function _interopRequireWildcard<T extends {__esModule: true}>(obj: T, nodeInterop?: false): T;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown;
function _interopRequireWildcard(obj: unknown, nodeInterop?: boolean): unknown { if (!nodeInterop && obj && readProperty(obj, "__esModule")) { return obj; } if (obj === null || _typeof(obj) !== "object" && typeof obj !== "function") { return { "default": obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(record(obj))) { return cache.get(record(obj)); } var newObj: Record<string, unknown> = {}; var hasPropertyDescriptor = readProperty(Object, "defineProperty") && Object.getOwnPropertyDescriptor; for (var key in record(obj)) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = readProperty(obj, key); } } } newObj["default"] = obj; if (cache) { cache.set(record(obj), newObj); } return newObj; }
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
var logger: LoggerLike | undefined;
var scopeManager: ScopeManagerLike | undefined;
function _default(ast: AstNode, loggerInstance: LoggerLike) {
  logger = loggerInstance;
  scopeManager = new (_ScopeManager["default"]!)();
  var variableMarker = new (_VariableMarker["default"]!)(scopeManager);
  (_traverser["default"]!).traverse(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      if (node.type === 'Program') {
        enterProgram(node);
      } else if (functionType.isFunctionDeclaration(node)) {
        enterFunctionDeclaration(node);
      } else if (functionType.isFunctionExpression(node)) {
        enterFunctionExpression(node);
      } else if (isBlockScopedStatement(node)) {
        scopeManager!.enterBlock();
      } else if (node.type === 'VariableDeclaration') {
        node.declarations.forEach(function (decl) {
          variableMarker.markDeclared(destructuring.extractVariableNames(declaratorView(decl).id!));

          // Uninitialized variables can never be const.
          // But variables in for-in/of loop heads are actually initialized (although init === null).
          var inForLoopHead = isAnyForStatement(parent) && readProperty(parent, "left") === node;
          if (declaratorView(decl).init === null && !inForLoopHead) {
            // eslint-disable-line no-null/no-null
            variableMarker.markModified(readProperty(declaratorView(decl).id, "name"));
          }
        });
      } else if (node.type === 'AssignmentExpression') {
        destructuring.extractVariableNames(node.left).forEach(function (name: string) {
          variableMarker.markModified(name);
        });
      } else if (variableType.isUpdate(node)) {
        variableMarker.markModified(node.argument.name);
      } else if (variableType.isReference(node, parent)) {
        variableMarker.markReferenced(node.name);
      }
    },
    leave: function leave(node: AstNode) {
      if (node.type === 'Program') {
        leaveProgram();
      } else if (functionType.isFunction(node)) {
        leaveFunction();
      } else if (isBlockScopedStatement(node)) {
        scopeManager!.leaveScope();
      }
    }
  });
}

// Block scope is usually delimited by { ... }
// But for-loop heads also constitute a block scope.
function isBlockScopedStatement(node: AstNode) {
  return node.type === 'BlockStatement' || isAnyForStatement(node);
}

// True when dealing with any kind of for-loop
function isAnyForStatement(node: AstNode | null): node is N.ForStatement | N.ForInStatement | N.ForOfStatement {
  return node!.type === 'ForStatement' || node!.type === 'ForInStatement' || node!.type === 'ForOfStatement';
}

// True when dealing with any kind of while-loop
function isAnyWhileStatement(node: AstNode | null): node is N.WhileStatement | N.DoWhileStatement {
  return node!.type === 'WhileStatement' || node!.type === 'DoWhileStatement';
}

// Program node works almost like a function:
// it hoists all variables which can be transformed to block-scoped let/const.
// It just doesn't have name and parameters.
// So we create an implied FunctionScope and BlockScope.
function enterProgram(node: AstNode) {
  scopeManager!.enterFunction();
  hoistFunction({
    body: node
  });
  scopeManager!.enterBlock();
}

// FunctionDeclaration has it's name visible outside the function,
// so we first register it in surrounding block-scope and
// after that enter new FunctionScope.
function enterFunctionDeclaration(func: N.FunctionDeclaration) {
  if (func.id) {
    getScope()!.register(func.id.name, getScope()!.findFunctionScoped(func.id.name));
  }
  scopeManager!.enterFunction();
  hoistFunction({
    params: func.params,
    body: func.body
  });
}

// FunctionExpression has it's name visible only inside the function,
// so we first enter new FunctionScope and
// hoist function name and params variables inside it.
function enterFunctionExpression(func: N.FunctionExpression | N.ArrowFunctionExpression) {
  scopeManager!.enterFunction();
  hoistFunction({
    id: func.id,
    params: func.params,
    body: func.body
  });
}
function hoistFunction(cfg: HoistConfig) {
  new (_FunctionHoister["default"]!)(getScope()!).hoist(cfg);
}

// Exits the implied BlockScope and FunctionScope of Program node
function leaveProgram() {
  scopeManager!.leaveScope();
  leaveFunction();
}

// Exits FunctionScope but first transforms all variables inside it
function leaveFunction() {
  transformVarsToLetOrConst();
  scopeManager!.leaveScope();
}

// This is where the actual transform happens
function transformVarsToLetOrConst() {
  getFunctionVariableGroups().forEach(function (group) {
    // Do not modify existing let & const
    if (group.getNode().kind !== 'var') {
      return;
    }
    if (isLexicalVariableProhibited(group)) {
      logWarningForVarKind(group.getNode());
      return;
    }
    var commonKind = group.getCommonKind();
    if (commonKind) {
      // When all variables in group are of the same kind,
      // just set appropriate `kind` value for the existing
      // VariableDeclaration node.
      group.getNode().kind = commonKind;
      logWarningForVarKind(group.getNode());
    } else if (hasMultiStatementBody(group.getParentNode())) {
      // When some variables are of a different kind,
      // create separate VariableDeclaration nodes for each
      // VariableDeclarator and set their `kind` value appropriately.
      var varNodes = group.getVariables().map(function (v) {
        return new (_VariableDeclaration["default"]!)(v.getKind(), [variableDeclarator(v.getNode())]);
      });
      (0, _multiReplaceStatement["default"])({
        parent: group.getParentNode(),
        node: group.getNode(),
        replacements: varNodes,
        preserveComments: true
      });
      logWarningForVarKind(group.getNode());
    } else {
      // When parent node restricts breaking VariableDeclaration to multiple ones
      // just change the kind of the declaration to the most restrictive possible
      group.getNode().kind = group.getMostRestrictiveKind();
      logWarningForVarKind(group.getNode());
    }
  });
}

// let and const declarations aren't allowed in all the same places where
// var declarations are allowed. Notably, only var-declaration can occur
// directlt in if-statement (and other similar statements) body:
//
//     if (true) var x = 10;
//
// let or const can only be used when the variable is declared in inside
// a block-statement:
//
//     if (true) { const x = 10; }
//
function isLexicalVariableProhibited(group: VariableGroupLike) {
  var node = group.getNode();
  var parentNode = group.getParentNode();
  if (parentNode!.type === 'IfStatement') {
    return parentNode!.consequent === node || parentNode!.alternate === node;
  }
  if (isAnyForStatement(parentNode) || isAnyWhileStatement(parentNode)) {
    return parentNode.body === node;
  }
  return false;
}
function logWarningForVarKind(node: N.VariableDeclaration) {
  if (node.kind === 'var') {
    logger!.warn(node, 'Unable to transform var', 'let');
  }
}

// Does a node have body that can contain an array of statements
function hasMultiStatementBody(node: AstNode | null) {
  return node!.type === 'BlockStatement' || node!.type === 'Program' || node!.type === 'SwitchCase';
}

// Returns all VariableGroups of variables in current function scope,
// including from all the nested block-scopes (but not the nested
// functions).
function getFunctionVariableGroups(): VariableGroupLike[] {
  return (0, _fp.flow)((0, _fp.map)(function (v: ScopeEntry) {
    return scopeVariable(v).getGroup();
  }), _fp.uniq, _fp.compact)(getScope()!.getVariables());
}
function getScope() {
  return scopeManager!.getScope();
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
