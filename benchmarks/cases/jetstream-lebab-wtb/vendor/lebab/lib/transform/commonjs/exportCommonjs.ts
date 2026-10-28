import type * as K from "../../../../../types/ast-types/gen/kinds.js";
import type {MatchResult} from "../../../../f-matches/index.ts";
import {classExpression, classIdentifier, matchedFunctionDeclaration, matchedClassDeclaration} from "./runtime.ts";
import type {AstNode, LoggerLike} from "../../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/commonjs/exportCommonjs.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../../webpack.ts";
import {load as load0} from "../../traverser.ts";
import {load as load1} from "./matchDefaultExport.ts";
import {load as load2} from "./matchNamedExport.ts";
import {load as load3} from "../../utils/functionType.ts";
import {load as load4} from "../../syntax/ExportNamedDeclaration.ts";
import {load as load5} from "../../syntax/VariableDeclaration.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/commonjs/exportCommonjs.js");
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
var _matchDefaultExport = _interopRequireDefault(load1());
var _matchNamedExport = _interopRequireDefault(load2());
var _functionType = load3();
var _ExportNamedDeclaration = _interopRequireDefault(load4());
var _VariableDeclaration = _interopRequireDefault(load5());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).replace(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      var m: MatchResult;
      if (m = (0, _matchDefaultExport["default"])(node)) {
        if (parent!.type !== 'Program') {
          logger.warn(node, 'export can only be at root level', 'commonjs');
          return;
        }
        return exportDefault(m, node.comments);
      } else if (m = (0, _matchNamedExport["default"])(node)) {
        if (parent!.type !== 'Program') {
          logger.warn(node, 'export can only be at root level', 'commonjs');
          return;
        }
        return exportNamed(m, node.comments);
      }
    }
  });
}
function exportDefault(_ref: Record<string, unknown>, comments: K.CommentKind[] | null | undefined): K.ExportDefaultDeclarationKind {
  var value = classExpression(_ref.value);
  return {
    type: 'ExportDefaultDeclaration',
    declaration: value,
    comments: comments
  };
}
function exportNamed(_ref2: Record<string, unknown>, comments: K.CommentKind[] | null | undefined) {
  var id = classIdentifier(_ref2.id),
    value = classExpression(_ref2.value);
  if ((0, _functionType.isFunctionExpression)(value)) {
    // Exclude functions with different name than the assigned property name
    if (compatibleIdentifiers(id, value.id)) {
      return new (_ExportNamedDeclaration["default"]!)({
        declaration: functionExpressionToDeclaration(value, id),
        comments: comments
      });
    }
  } else if (value.type === 'ClassExpression') {
    // Exclude classes with different name than the assigned property name
    if (compatibleIdentifiers(id, value.id)) {
      return new (_ExportNamedDeclaration["default"]!)({
        declaration: classExpressionToDeclaration(value, id),
        comments: comments
      });
    }
  } else if (value.type === 'Identifier') {
    return new (_ExportNamedDeclaration["default"]!)({
      specifiers: [{
        type: 'ExportSpecifier',
        exported: id,
        local: value
      }],
      comments: comments
    });
  } else {
    return new (_ExportNamedDeclaration["default"]!)({
      declaration: new (_VariableDeclaration["default"]!)('var', [{
        type: 'VariableDeclarator',
        id: id,
        init: value
      }]),
      comments: comments
    });
  }
}

// True when one of the identifiers is null or their names are equal.
function compatibleIdentifiers(id1: K.IdentifierKind | null | undefined, id2: K.IdentifierKind | null | undefined) {
  return !id1 || !id2 || id1.name === id2.name;
}
function functionExpressionToDeclaration(func: K.FunctionDeclarationKind | K.FunctionExpressionKind | K.ArrowFunctionExpressionKind, id: K.IdentifierKind) {
  func.type = 'FunctionDeclaration';
  func.id = id;

  // Transform <expression> to { return <expression>; }
  if (func.body.type !== 'BlockStatement') {
    func.body = {
      type: 'BlockStatement',
      body: [{
        type: 'ReturnStatement',
        argument: func.body
      }]
    };
  }
  return matchedFunctionDeclaration(func);
}
function classExpressionToDeclaration(cls: K.ClassDeclarationKind | K.ClassExpressionKind, id: K.IdentifierKind) {
  cls.type = 'ClassDeclaration';
  cls.id = id;
  return matchedClassDeclaration(cls);
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
