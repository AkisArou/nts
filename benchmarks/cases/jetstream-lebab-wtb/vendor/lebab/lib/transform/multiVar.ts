import type * as K from "../../../../types/ast-types/gen/kinds.js";
import {classNode, classExpression, classText, programNode} from "./runtime-transforms.ts";
import type {AstNode, LoggerLike} from "../../../../ast.ts";
import type {Constructor, Descriptor} from "../../../../webpack.ts";
// Exact module body from JetStream 3.0 ./node_modules/lebab/lib/transform/multiVar.js.
// Dependencies are loaded at the original call sites; the cached export object is retained.
import {exportsReady, webpack, isRecord, record, readProperty, symbolValue, primitiveMethod, hasEsModuleFlag} from "../../../../webpack.ts";
import {load as load0} from "../traverser.ts";
import {load as load1} from "../utils/multiReplaceStatement.ts";
import {load as load2} from "../syntax/VariableDeclaration.ts";

let cache: {exports: Partial<ReturnType<typeof initialize>>} | undefined;
export function load(): ReturnType<typeof initialize> {
 if (cache !== undefined) {
  const value = cache.exports;
  if (!isExport(value)) throw new TypeError("Unexpected cached export for lebab/lib/transform/multiVar.js");
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
var _multiReplaceStatement = _interopRequireDefault(load1());
var _VariableDeclaration = _interopRequireDefault(load2());
function _interopRequireDefault<T extends {__esModule: true}>(obj: T): T;
function _interopRequireDefault<T>(obj: T): {default: T};
function _interopRequireDefault(obj: unknown) { return obj && readProperty(obj, "__esModule") ? obj : { "default": obj }; }
function _default(ast: AstNode, logger: LoggerLike) {
  (_traverser["default"]!).traverse(ast, {
    enter: function enter(node: AstNode, parent: AstNode | null) {
      if (node.type === 'VariableDeclaration' && node.declarations.length > 1) {
        splitDeclaration(node, parent, logger);
        return (_traverser["default"]!).VisitorOption.Skip;
      }
    }
  });
}
function splitDeclaration(node: K.VariableDeclarationKind, parent: AstNode | null, logger: LoggerLike) {
  var declNodes = node.declarations.map(function (declarator) {
    return new (_VariableDeclaration["default"]!)(node.kind, [declarator]);
  });
  try {
    (0, _multiReplaceStatement["default"])({
      parent: parent,
      node: node,
      replacements: declNodes,
      preserveComments: true
    });
  } catch (e) {
    logger.warn(parent!, "Unable to split var statement in a ".concat(parent!.type), 'multi-var');
  }
}

/***/ 
if (!hasEsModuleFlag(exports)) throw new TypeError("Expected the initialized ES module flag");
if (!exportsReady(exports, ["default"])) throw new TypeError("Incomplete bundled exports");
return exports;
}
